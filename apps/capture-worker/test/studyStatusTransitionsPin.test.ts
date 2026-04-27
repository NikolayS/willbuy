/**
 * studyStatusTransitionsPin.test.ts — spec-pin for study status SQL strings
 * in apps/capture-worker/src/poller.ts (spec §5.11).
 *
 * The capture-worker drives the first state-machine transition:
 *   study.status = 'capturing'  →  study.status = 'visiting'
 *
 * pollOnce SELECTs visits whose study is in 'capturing' state; when all visits
 * for a study are terminal (ok | failed | indeterminate), maybeAdvanceStudy
 * UPDATEs the study to 'visiting' to kick the visitor-worker.
 *
 * Both strings are SQL template-literal values, not TypeScript types.
 * Renaming either (e.g. 'capturing' → 'running') compiles cleanly but breaks
 * the poll query or the state transition at runtime.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'poller.ts'), 'utf8');

describe("capture-worker poller study status SQL strings (spec §5.11)", () => {
  it("reads visits for studies with status = 'capturing'", () => {
    expect(src).toContain("s.status = 'capturing'");
  });

  it("advances study to status = 'visiting' when all visits are terminal", () => {
    expect(src).toContain("SET status = 'visiting'");
  });

  it("the transition guard checks AND status = 'capturing' to be idempotent", () => {
    expect(src).toContain("AND status = 'capturing'");
  });

  it("'visiting' write appears after 'capturing' read in the file", () => {
    const readIdx = src.indexOf("s.status = 'capturing'");
    const writeIdx = src.indexOf("SET status = 'visiting'");
    expect(readIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(readIdx);
  });
});
