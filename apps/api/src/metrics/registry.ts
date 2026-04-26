/**
 * metrics/registry.ts — zero-dep Prometheus exposition registry (issue #119).
 *
 * Spec refs:
 *   §5.12  — observability metrics emission policy.
 *   §5.14  — global backpressure metrics (this v0.2 slice scopes to the
 *            apps/api business + system signals listed below; the worker-
 *            side counters from §5.14 are wired in follow-up issues).
 *
 * Design notes:
 *   - We deliberately avoid `prom-client` to keep the dep surface flat and
 *     Bun-friendly (issue #117 / amendment A3 cutover). The exposition
 *     format is small and stable; a hand-rolled serializer is cheaper than
 *     pulling a 200kB transitive tree for v0.2.
 *   - All metrics live in a single module-level registry. Tests reset state
 *     via {@link resetMetricsForTesting}.
 *   - Label cardinality is bounded by enum-typed call sites; route labels
 *     come from the Fastify route template (never from raw URLs).
 *
 * Exposition format reference (Prometheus 0.0.4):
 *   https://prometheus.io/docs/instrumenting/exposition_formats/
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Content type
// ---------------------------------------------------------------------------

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

// ---------------------------------------------------------------------------
// Internal helpers — label encoding
// ---------------------------------------------------------------------------

function escapeLabelValue(v: string): string {
  // §0.0.4 spec: backslash, double-quote, and newline must be escaped.
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`);
  return `{${parts.join(',')}}`;
}

function labelsKey(labels: Record<string, string>): string {
  // Stable serialized key for map lookup — sorted for determinism.
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join('|');
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

interface CounterDef {
  name: string;
  help: string;
  labelNames: readonly string[];
  values: Map<string, { labels: Record<string, string>; value: number }>;
}

function makeCounter(name: string, help: string, labelNames: readonly string[]): CounterDef {
  return { name, help, labelNames, values: new Map() };
}

function incCounter(c: CounterDef, labels: Record<string, string>, by = 1): void {
  // Validate labelset matches definition.
  for (const k of c.labelNames) {
    if (!(k in labels)) throw new Error(`metric ${c.name}: missing label ${k}`);
  }
  for (const k of Object.keys(labels)) {
    if (!c.labelNames.includes(k)) throw new Error(`metric ${c.name}: unexpected label ${k}`);
  }
  const key = labelsKey(labels);
  const entry = c.values.get(key);
  if (entry) {
    entry.value += by;
  } else {
    c.values.set(key, { labels: { ...labels }, value: by });
  }
}

function renderCounter(c: CounterDef): string {
  const lines: string[] = [];
  lines.push(`# HELP ${c.name} ${c.help}`);
  lines.push(`# TYPE ${c.name} counter`);
  if (c.values.size === 0 && c.labelNames.length === 0) {
    lines.push(`${c.name} 0`);
  } else if (c.values.size === 0) {
    // Counters with required labels still need their HELP/TYPE lines emitted
    // (so Prometheus knows the metric exists) — but no value lines until the
    // first observation.
  } else {
    for (const v of c.values.values()) {
      lines.push(`${c.name}${renderLabels(v.labels)} ${v.value}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

interface GaugeDef {
  name: string;
  help: string;
  labelNames: readonly string[];
  values: Map<string, { labels: Record<string, string>; value: number }>;
  /** Optional: invoked at scrape time so the gauge reports a live value. */
  collect?: (() => void) | undefined;
}

function makeGauge(
  name: string,
  help: string,
  labelNames: readonly string[],
  collect?: () => void,
): GaugeDef {
  return { name, help, labelNames, values: new Map(), collect };
}

function setGauge(g: GaugeDef, labels: Record<string, string>, value: number): void {
  for (const k of g.labelNames) {
    if (!(k in labels)) throw new Error(`metric ${g.name}: missing label ${k}`);
  }
  for (const k of Object.keys(labels)) {
    if (!g.labelNames.includes(k)) throw new Error(`metric ${g.name}: unexpected label ${k}`);
  }
  const key = labelsKey(labels);
  g.values.set(key, { labels: { ...labels }, value });
}

function renderGauge(g: GaugeDef): string {
  if (g.collect) g.collect();
  const lines: string[] = [];
  lines.push(`# HELP ${g.name} ${g.help}`);
  lines.push(`# TYPE ${g.name} gauge`);
  if (g.values.size === 0 && g.labelNames.length === 0) {
    lines.push(`${g.name} 0`);
  } else {
    for (const v of g.values.values()) {
      lines.push(`${g.name}${renderLabels(v.labels)} ${v.value}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

interface HistogramSeries {
  labels: Record<string, string>;
  buckets: number[]; // running counts per bucket index (cumulative is computed at render)
  sum: number;
  count: number;
}

interface HistogramDef {
  name: string;
  help: string;
  labelNames: readonly string[];
  bucketBounds: readonly number[]; // ascending; +Inf is implicit
  values: Map<string, HistogramSeries>;
}

function makeHistogram(
  name: string,
  help: string,
  labelNames: readonly string[],
  bucketBounds: readonly number[],
): HistogramDef {
  return { name, help, labelNames, bucketBounds, values: new Map() };
}

function observeHistogram(h: HistogramDef, labels: Record<string, string>, value: number): void {
  for (const k of h.labelNames) {
    if (!(k in labels)) throw new Error(`metric ${h.name}: missing label ${k}`);
  }
  for (const k of Object.keys(labels)) {
    if (!h.labelNames.includes(k)) throw new Error(`metric ${h.name}: unexpected label ${k}`);
  }
  const key = labelsKey(labels);
  let s = h.values.get(key);
  if (!s) {
    s = {
      labels: { ...labels },
      buckets: new Array(h.bucketBounds.length).fill(0),
      sum: 0,
      count: 0,
    };
    h.values.set(key, s);
  }
  s.sum += value;
  s.count += 1;
  for (let i = 0; i < h.bucketBounds.length; i++) {
    if (value <= h.bucketBounds[i]!) s.buckets[i] = (s.buckets[i] ?? 0) + 1;
  }
}

function renderHistogram(h: HistogramDef): string {
  const lines: string[] = [];
  lines.push(`# HELP ${h.name} ${h.help}`);
  lines.push(`# TYPE ${h.name} histogram`);
  for (const s of h.values.values()) {
    for (let i = 0; i < h.bucketBounds.length; i++) {
      const le = h.bucketBounds[i]!;
      const labels = { ...s.labels, le: formatNumber(le) };
      lines.push(`${h.name}_bucket${renderLabels(labels)} ${s.buckets[i]}`);
    }
    // +Inf bucket
    lines.push(`${h.name}_bucket${renderLabels({ ...s.labels, le: '+Inf' })} ${s.count}`);
    lines.push(`${h.name}_sum${renderLabels(s.labels)} ${formatNumber(s.sum)}`);
    lines.push(`${h.name}_count${renderLabels(s.labels)} ${s.count}`);
  }
  return lines.join('\n');
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return n > 0 ? '+Inf' : '-Inf';
  // Prometheus prefers Go-style formatting; toString is fine for non-fractional
  // ints, and for floats with reasonable precision.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// Registry — module-level singletons
// ---------------------------------------------------------------------------

// Histogram buckets tuned for HTTP request durations on a Fastify API:
// most requests are sub-100ms; outliers (LLM-touching POST routes) reach
// ~30s; the 30s bucket covers the willbuy worst-case capture timeout.
const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
] as const;

const studiesStartedTotal = makeCounter(
  'willbuy_studies_started_total',
  'Total number of studies created (POST /studies). `kind` ∈ {single,paired} per §2 #12.',
  ['kind'] as const,
);

const studiesCompletedTotal = makeCounter(
  'willbuy_studies_completed_total',
  'Total studies that reached a terminal state. `outcome` ∈ {ok,partial,failed}.',
  ['kind', 'outcome'] as const,
);

const visitsTotal = makeCounter(
  'willbuy_visits_total',
  'Total visit-job transitions observed by the API. `persona_pool` is the ICP archetype set per §2 #9.',
  ['persona_pool'] as const,
);

const creditsConsumedTotal = makeCounter(
  'willbuy_credits_consumed_total',
  'Total credit-ledger debits in cents grouped by study kind (§5.4).',
  ['kind'] as const,
);

const activeStudies = makeGauge(
  'willbuy_active_studies',
  'Number of studies whose status is in {pending,capturing,visiting,aggregating}. Set by the route handler at scrape time when a probe is registered.',
  [] as const,
);

const httpRequestDurationSeconds = makeHistogram(
  'willbuy_http_request_duration_seconds',
  'Fastify HTTP request duration in seconds. `route` is the parameterized template; "__unmatched__" for 404 paths with no matching route (bounded cardinality, issue #119).',
  ['route', 'method', 'status'] as const,
  HTTP_DURATION_BUCKETS,
);

const processStartUnixTime = makeGauge(
  'willbuy_process_start_time_seconds',
  'Process start time in unix seconds (UTC). Compute uptime as `time() - willbuy_process_start_time_seconds`.',
  [] as const,
);

const buildInfo = makeGauge(
  'willbuy_build_info',
  'Build info (always 1). The `version` label carries the apps/api package.json version.',
  ['version'] as const,
);

// Resolve apps/api/package.json once at module load.
function resolvePkgVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/metrics/registry.js (built) or src/metrics/registry.ts — both are
    // 2 levels below apps/api.
    const pkgPath = resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Initialize self-describing gauges once. Reset by resetMetricsForTesting().
function initSelfDescribingMetrics(): void {
  setGauge(processStartUnixTime, {}, Math.floor(Date.now() / 1000));
  setGauge(buildInfo, { version: resolvePkgVersion() }, 1);
}
initSelfDescribingMetrics();

// ---------------------------------------------------------------------------
// Public API — recording helpers
// ---------------------------------------------------------------------------

export interface RecordStudyStartedArgs {
  kind: 'single' | 'paired';
}

export function recordStudyStarted(args: RecordStudyStartedArgs): void {
  incCounter(studiesStartedTotal, { kind: args.kind });
}

export interface RecordStudyCompletedArgs {
  kind: 'single' | 'paired';
  outcome: 'ok' | 'partial' | 'failed';
}

export function recordStudyCompleted(args: RecordStudyCompletedArgs): void {
  incCounter(studiesCompletedTotal, { kind: args.kind, outcome: args.outcome });
}

export interface RecordVisitArgs {
  /**
   * Bounded ICP-pool identifier. For preset ICPs this is the preset_id (§2 #9
   * — 5 enum values); for inline / custom ICPs use the literal string
   * "custom" so cardinality stays bounded. Callers must NOT pass user-supplied
   * free-text here.
   */
  persona_pool: string;
}

export function recordVisit(args: RecordVisitArgs): void {
  incCounter(visitsTotal, { persona_pool: args.persona_pool });
}

export interface RecordCreditsConsumedArgs {
  kind: 'single' | 'paired';
  cents: number;
}

export function recordCreditsConsumed(args: RecordCreditsConsumedArgs): void {
  incCounter(creditsConsumedTotal, { kind: args.kind }, args.cents);
}

export function setActiveStudies(n: number): void {
  setGauge(activeStudies, {}, n);
}

export interface RecordHttpRequestArgs {
  route: string;
  method: string;
  status: number;
  durationSeconds: number;
}

export function recordHttpRequest(args: RecordHttpRequestArgs): void {
  observeHistogram(
    httpRequestDurationSeconds,
    { route: args.route, method: args.method, status: String(args.status) },
    args.durationSeconds,
  );
}

// ---------------------------------------------------------------------------
// Bearer auth — constant-time compare
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two strings. Returns false immediately for
 * different lengths (length itself is not a side channel here — the caller's
 * bearer token has a known minimum length, and the comparison result is the
 * only signal we need to keep secret).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Exposition rendering
// ---------------------------------------------------------------------------

export function renderExposition(): string {
  const sections = [
    renderCounter(studiesStartedTotal),
    renderCounter(studiesCompletedTotal),
    renderCounter(visitsTotal),
    renderCounter(creditsConsumedTotal),
    renderGauge(activeStudies),
    renderHistogram(httpRequestDurationSeconds),
    renderGauge(processStartUnixTime),
    renderGauge(buildInfo),
  ];
  // Trailing newline per §0.0.4 — many scrapers tolerate either, but the
  // specification requires LF-terminated.
  return sections.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Test reset
// ---------------------------------------------------------------------------

export function resetMetricsForTesting(): void {
  studiesStartedTotal.values.clear();
  studiesCompletedTotal.values.clear();
  visitsTotal.values.clear();
  creditsConsumedTotal.values.clear();
  activeStudies.values.clear();
  httpRequestDurationSeconds.values.clear();
  processStartUnixTime.values.clear();
  buildInfo.values.clear();
  initSelfDescribingMetrics();
}
