/**
 * aggregatorLockStatusPin.test.ts — spec-pin for study status strings in
 * apps/api/src/finalize/aggregator-lock.ts (spec §5.11).
 *
 * acquireFinalizeLock reads status='aggregating' to claim the single-writer lock.
 * commitReport writes status='ready' on successful finalization.
 * failStudy   writes status='failed' on aggregation failure.
 *
 * These are SQL template-literal strings, not TypeScript types. A coordinated
 * rename compiles cleanly but breaks the state machine at runtime because the
 * migration CHECK constraint (0002_studies.sql) only recognises the original
 * values.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(here, '..', 'src', 'finalize', 'aggregator-lock.ts'),
  'utf8',
);

describe("aggregator-lock.ts study status SQL strings (spec §5.11)", () => {
  it("acquireFinalizeLock reads status = 'aggregating'", () => {
    expect(src).toContain("status = 'aggregating'");
  });

  it("commitReport writes status = 'ready'", () => {
    expect(src).toContain("status = 'ready'");
  });

  it("failStudy writes status = 'failed'", () => {
    expect(src).toContain("status = 'failed'");
  });

  it("all three status strings appear in correct function order", () => {
    const aggIdx = src.indexOf("status = 'aggregating'");
    const readyIdx = src.indexOf("status = 'ready'");
    const failedIdx = src.indexOf("status = 'failed'");
    // acquireFinalizeLock precedes commitReport precedes failStudy in the file.
    expect(aggIdx).toBeGreaterThan(-1);
    expect(readyIdx).toBeGreaterThan(aggIdx);
    expect(failedIdx).toBeGreaterThan(readyIdx);
  });
});
