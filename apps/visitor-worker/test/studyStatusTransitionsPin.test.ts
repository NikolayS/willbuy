/**
 * studyStatusTransitionsPin.test.ts — spec-pin for study status SQL strings
 * in apps/visitor-worker/src/poller.ts (spec §5.11).
 *
 * The visitor-worker drives the second state-machine transition:
 *   study.status = 'visiting'  →  study.status = 'aggregating'
 *
 * pollOnce SELECTs visits whose study is in 'visiting' state; when all visits
 * are processed, maybeAdvanceStudy UPDATEs the study to 'aggregating' to hand
 * off to the aggregator subprocess.
 *
 * Both strings are SQL template-literal values, not TypeScript types.
 * Renaming either (e.g. 'visiting' → 'running') compiles cleanly but breaks
 * the poll query or the state transition at runtime.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'poller.ts'), 'utf8');

describe("visitor-worker poller study status SQL strings (spec §5.11)", () => {
  it("reads visits for studies with status = 'visiting'", () => {
    expect(src).toContain("s.status = 'visiting'");
  });

  it("advances study to status = 'aggregating' when all visits are processed", () => {
    expect(src).toContain("SET status = 'aggregating'");
  });

  it("the transition guard checks AND status = 'visiting' to be idempotent", () => {
    expect(src).toContain("AND status = 'visiting'");
  });

  it("'aggregating' write appears after 'visiting' read in the file", () => {
    const readIdx = src.indexOf("s.status = 'visiting'");
    const writeIdx = src.indexOf("SET status = 'aggregating'");
    expect(readIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(readIdx);
  });
});
