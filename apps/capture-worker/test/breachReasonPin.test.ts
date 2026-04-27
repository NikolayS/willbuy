/**
 * breachReasonPin.test.ts — spec-pin for BreachReason union type values
 * in apps/capture-worker/src/types.ts (spec §2 #6).
 *
 * BreachReason categorises which ceiling was hit when a capture returns
 * status='error'. These string values are included in:
 *   - CaptureResult.breach_reason (returned to the capture-worker caller)
 *   - Structured log event field `breach_reason`
 *   - canary.ts verdict reason string: `breach=${actual.breach_reason}`
 *
 * Renaming any value (e.g. 'wall_clock' → 'timeout') compiles cleanly
 * but breaks downstream code that pattern-matches on the reason string —
 * alerting rules, log filters, and operator runbooks silently stop firing.
 *
 * The 6 values must stay in sync with CAPTURE_CEILINGS (also in types.ts):
 *   wall_clock → WALL_CLOCK_MS, host_count → HOST_COUNT,
 *   dom_nodes → DOM_NODES, total_bytes → TOTAL_BYTES,
 *   a11y_tree_bytes → A11Y_TREE_BYTES, memory → (cgroup-enforced).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'types.ts'), 'utf8');

describe("BreachReason union type values (spec §2 #6)", () => {
  it("contains 'wall_clock' (wall-clock ceiling, WALL_CLOCK_MS=45s)", () => {
    expect(src).toContain("'wall_clock'");
  });

  it("contains 'host_count' (egress host budget, HOST_COUNT=50)", () => {
    expect(src).toContain("'host_count'");
  });

  it("contains 'dom_nodes' (DOM node ceiling, DOM_NODES=250_000)", () => {
    expect(src).toContain("'dom_nodes'");
  });

  it("contains 'total_bytes' (payload size ceiling, TOTAL_BYTES=25MB)", () => {
    expect(src).toContain("'total_bytes'");
  });

  it("contains 'a11y_tree_bytes' (a11y tree size ceiling, A11Y_TREE_BYTES=10MB)", () => {
    expect(src).toContain("'a11y_tree_bytes'");
  });

  it("contains 'memory' (cgroup RAM ceiling — logged but not JS-enforced)", () => {
    expect(src).toContain("'memory'");
  });

  it("BreachReason has exactly 6 members", () => {
    // Each member is preceded by | so there are 6 pipe characters.
    const typeStart = src.indexOf('export type BreachReason =');
    const typeEnd = src.indexOf(';', typeStart);
    const typeBlock = src.slice(typeStart, typeEnd);
    const pipeCount = (typeBlock.match(/\|/g) ?? []).length;
    expect(pipeCount).toBe(6);
  });
});
