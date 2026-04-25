// CaptureResult, A11yNode, and BreachReason are intentionally kept in this
// package. Issue #4 (PR #18) landed @willbuy/shared with visitor/scoring/
// backstory types — capture-specific wire types were out of scope there and
// remain here to avoid premature cross-package coupling (CLAUDE.md §coding).

/**
 * A single node in the serialized accessibility tree returned by
 * `captureUrl`. Shape is intentionally minimal and stable: role + name +
 * the structural information a synthetic visitor LLM needs to reason
 * about the page (image alt text, button labels, heading hierarchy,
 * link targets). See spec §2 #2 (capture output) and the
 * `pages/snapshot-*.md` examples in the growth repo for the SPIRIT
 * we're matching.
 */
export type A11yNode = {
  role: string;
  name: string;
  // Optional CDP-derived metadata. Present only when meaningful.
  level?: number; // heading level (1..6)
  value?: string; // text input value, etc.
  description?: string;
  url?: string; // link target (href) — flattened from the underlying DOM
  children: A11yNode[];
};

export type BreachReason =
  | 'wall_clock'
  | 'host_count'
  | 'dom_nodes'
  | 'total_bytes'
  | 'a11y_tree_bytes'
  | 'memory';

export type CaptureStatus = 'ok' | 'blocked' | 'error';

/**
 * One-shot capture output. Serializable; this is the typed payload the
 * v0.1 capture broker (§5.13) will receive over its Unix domain socket.
 * The broker server itself is OUT OF SCOPE for this issue — we just
 * pin the schema here so the broker integration in Sprint 2 is a wire
 * change, not a schema change.
 */
export type CaptureResult = {
  status: CaptureStatus;
  url: string;
  a11y_tree: A11yNode[];
  // v0.1 ships an empty list — the curated cookie-banner selector list
  // and DOM-removal logic land in Sprint 2 (§2 #7 + §5.9).
  banner_selectors_matched: string[];
  // Distinct egress eTLD-ish hosts observed by the Playwright network
  // listener. The §2 #5 budget is ≤ 50.
  host_count: number;
  // Populated only when one of the §2 #6 ceilings was hit; status is
  // 'error' in that case.
  breach_reason?: BreachReason;
  // Populated only when we reached `status: 'blocked'` (e.g. the target
  // refused the request). v0.1 leaves the surface minimal and lets the
  // broker enrich on the host side.
  blocked_reason?: string;
};

/**
 * Spec §2 #6 capture resource ceilings. Centralized here so both the
 * implementation and the breach tests reference one source of truth.
 */
export const CAPTURE_CEILINGS = {
  WALL_CLOCK_MS: 45_000,
  TOTAL_BYTES: 25 * 1024 * 1024,
  DOM_NODES: 250_000,
  A11Y_TREE_BYTES: 10 * 1024 * 1024,
  HOST_COUNT: 50,
  // RAM ≤ 1 GB and CPU ≤ 1 vCPU are enforced by the container runtime
  // (deploy-side cgroup limits in Sprint 2), not by JS code, since a
  // browser process that has already OOM'd cannot reliably self-report.
} as const;

export type CaptureOpts = {
  /** Override §2 #6 wall-clock ceiling (ms). Tests inject lower values. */
  wallClockMs?: number;
  /** Override §2 #5 distinct-host budget. Tests inject lower values. */
  hostCountBudget?: number;
  /** Override §2 #6 total-bytes ceiling (bytes). Tests inject lower values. */
  totalBytesBudget?: number;
  /** Override §2 #6 a11y-tree-bytes ceiling (bytes). Tests inject lower values. */
  a11yTreeBytesBudget?: number;
  /** Override §2 #6 DOM-nodes ceiling. Tests inject lower values. */
  domNodesBudget?: number;
  /**
   * Optional URL→host mapper used by tests to deterministically simulate
   * subresources hitting many distinct hosts without actually opening
   * sockets. The default (production) behavior derives the host from the
   * Playwright `request` event URL.
   */
  hostExtractor?: (rawUrl: string) => string | null;
};
