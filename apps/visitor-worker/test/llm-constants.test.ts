/**
 * llm-constants.test.ts — spec-pin tests for the LLM call constants in
 * visitor.ts (spec §2 #15, §2 #14).
 *
 * MAX_OUTPUT_TOKENS (800) limits each LLM call so cost stays bounded.
 * MAX_REPAIR_GENERATION (2) caps the schema-repair retry loop at 3 total
 * calls (generations 0, 1, 2). Silent changes to either would silently
 * break the cost model or allow infinite repair loops.
 *
 * Tests:
 *   1. MAX_OUTPUT_TOKENS is 800 (spec §2 #15).
 *   2. MAX_REPAIR_GENERATION is 2 (spec §2 #14 — "up to 2 retries").
 *   3. MAX_REPAIR_GENERATION + 1 = 3 total calls maximum (0-indexed).
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/visitor.js';

const { MAX_OUTPUT_TOKENS, MAX_REPAIR_GENERATION } = __test__;

describe('LLM call constants spec-pin (spec §2 #15, §2 #14)', () => {
  it('MAX_OUTPUT_TOKENS is 800 (spec §2 #15 output-token cap)', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(800);
  });

  it('MAX_REPAIR_GENERATION is 2 (spec §2 #14 — up to 2 schema-repair retries)', () => {
    expect(MAX_REPAIR_GENERATION).toBe(2);
  });

  it('maximum total chat() calls is 3 (generations 0, 1, 2 — initial + 2 repairs)', () => {
    expect(MAX_REPAIR_GENERATION + 1).toBe(3);
  });
});
