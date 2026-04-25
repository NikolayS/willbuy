import { describe, expect, it } from 'vitest';

// Acceptance #0 (skeleton): the package exports `runVisit` and the
// `VisitResult` type contract documented on issue #9.
//
// This sits ahead of every behavioral acceptance — it is the smallest
// red→green pair that proves the module wires up, before any LLM logic.

describe('@willbuy/visitor-worker — package skeleton (issue #9)', () => {
  it('exports runVisit as a function from the index entrypoint', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.runVisit).toBe('function');
  });
});
