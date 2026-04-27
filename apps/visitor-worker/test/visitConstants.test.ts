/**
 * visitConstants.test.ts — spec-pins for MAX_OUTPUT_TOKENS and
 * MAX_REPAIR_GENERATION in visitor.ts.
 *
 * MAX_OUTPUT_TOKENS=800 (spec §2 #15):
 *   Each visitor LLM call is capped at 800 output tokens. Raising it increases
 *   cost without spec approval; lowering it risks truncating valid JSON output
 *   (the VisitorOutput schema is ~400 tokens at minimum) and causing spurious
 *   schema failures.
 *
 * MAX_REPAIR_GENERATION=2 (spec §2 #14):
 *   Schema repairs are attempted up to 2 times (repair_generation 0→1→2),
 *   giving 3 chat() calls maximum per visit. Setting this to 1 gives up after
 *   one repair attempt; setting it to 0 disables schema repair entirely.
 *   The total-calls-per-visit invariant (MAX_REPAIR_GENERATION + 1) is also
 *   pinned to catch a drift between the constant and the prose comment.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/visitor.js';

const { MAX_OUTPUT_TOKENS, MAX_REPAIR_GENERATION } = __test__;

describe('MAX_OUTPUT_TOKENS spec-pin (visitor.ts — spec §2 #15)', () => {
  it('is 800', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(800);
  });
});

describe('MAX_REPAIR_GENERATION spec-pin (visitor.ts — spec §2 #14)', () => {
  it('is 2 (allows 2 repair attempts after initial call)', () => {
    expect(MAX_REPAIR_GENERATION).toBe(2);
  });

  it('total chat() calls per visit is MAX_REPAIR_GENERATION + 1 = 3', () => {
    expect(MAX_REPAIR_GENERATION + 1).toBe(3);
  });
});
