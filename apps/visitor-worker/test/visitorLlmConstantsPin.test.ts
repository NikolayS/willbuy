/**
 * visitorLlmConstantsPin.test.ts — spec-pin for visitor LLM call constants.
 *
 * Spec refs:
 *   §2 #15 — MAX_OUTPUT_TOKENS=800 (visitor LLM output cap).
 *   §2 #14 — MAX_REPAIR_GENERATION=2 (schema-repair retry limit; total calls=3).
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/visitor.js';

const { MAX_OUTPUT_TOKENS, MAX_REPAIR_GENERATION } = __test__;

describe('Visitor LLM call constants (spec §2 #14, §2 #15)', () => {
  it('MAX_OUTPUT_TOKENS is 800 (spec §2 #15)', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(800);
  });

  it('MAX_REPAIR_GENERATION is 2 (spec §2 #14)', () => {
    expect(MAX_REPAIR_GENERATION).toBe(2);
  });

  it('total calls per visit = MAX_REPAIR_GENERATION + 1 = 3 (initial + 2 repairs)', () => {
    expect(MAX_REPAIR_GENERATION + 1).toBe(3);
  });
});
