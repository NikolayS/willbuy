/**
 * eventNamesPin.test.ts — spec-pin for structured-log event names emitted by
 * apps/capture-worker/src/poller.ts and apps/capture-worker/src/index.ts.
 *
 * These event strings appear as `event:` fields in pino JSON log lines.
 * Alerting rules (Loki LogQL, Grafana alerts) filter on these values.
 * Renaming any of them would silently break on-call alerts with no test
 * catching the mismatch.
 *
 * Covered events and their operational meaning:
 *
 *   poller.ts:
 *     'broker.rejected'      — capture broker rejected the artifact (a11y
 *                              too big, schema invalid, etc.); pager-level
 *     'broker.send_failed'   — capture-worker could not reach the broker
 *                              socket; pager-level
 *     'capture.no_url'       — visit row has no URL configured; study-setup
 *                              bug
 *   index.ts:
 *     'startup.runtime'      — logged at startup with the selected capture
 *                              runtime; used for version/config auditing
 *     'startup.missing_env'  — DATABASE_URL not set; fatal startup failure
 *     'shutdown.sigterm'     — SIGTERM received; draining
 *     'shutdown.drained'     — draining complete; clean exit
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pollerSrc = readFileSync(resolve(here, '..', 'src', 'poller.ts'), 'utf8');
const indexSrc = readFileSync(resolve(here, '..', 'src', 'index.ts'), 'utf8');

describe("capture-worker structured-log event names spec-pin (spec §5.13, §5.12)", () => {
  // ── poller.ts events ──────────────────────────────────────────────────────

  it("'broker.rejected' event name is present in poller.ts", () => {
    expect(pollerSrc).toContain("'broker.rejected'");
  });

  it("'broker.send_failed' event name is present in poller.ts", () => {
    expect(pollerSrc).toContain("'broker.send_failed'");
  });

  it("'capture.no_url' event name is present in poller.ts", () => {
    expect(pollerSrc).toContain("'capture.no_url'");
  });

  // ── index.ts events ───────────────────────────────────────────────────────

  it("'startup.runtime' event name is present in index.ts", () => {
    expect(indexSrc).toContain("'startup.runtime'");
  });

  it("'startup.missing_env' event name is present in index.ts", () => {
    expect(indexSrc).toContain("'startup.missing_env'");
  });

  it("'shutdown.sigterm' event name is present in index.ts", () => {
    expect(indexSrc).toContain("'shutdown.sigterm'");
  });

  it("'shutdown.drained' event name is present in index.ts", () => {
    expect(indexSrc).toContain("'shutdown.drained'");
  });
});
