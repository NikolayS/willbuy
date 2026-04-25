import { describe, expect, it } from 'vitest';

import { LocalCliProvider, LOCAL_CLI_CAPABILITIES } from '../src/index.js';

// Spec §2 #27: pluggable LLM adapter declares capability flags
// (idempotency, zero_retention, structured_output, prompt_caching).
// Issue #5 acceptance #5: capability flags returned by
// LocalCliProvider.capabilities() match a documented constant — no CLI
// introspection in v0.1.
describe('LocalCliProvider — capabilities()', () => {
  it('returns the documented constant flag set', () => {
    const provider = new LocalCliProvider();
    expect(provider.capabilities()).toStrictEqual(LOCAL_CLI_CAPABILITIES);
  });

  it('declares all four spec-required capability flags as booleans', () => {
    const caps = new LocalCliProvider().capabilities();
    expect(typeof caps.idempotency).toBe('boolean');
    expect(typeof caps.zero_retention).toBe('boolean');
    expect(typeof caps.structured_output).toBe('boolean');
    expect(typeof caps.prompt_caching).toBe('boolean');
  });

  it('reports a stable, generic provider name() that does not leak vendor identifiers', () => {
    const name = new LocalCliProvider().name();
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
    // CLAUDE.md "No vendor name leaks" + issue #5 generic-naming requirement.
    expect(name).not.toMatch(/anthropic|claude|openai|gpt|gemini/i);
  });
});
