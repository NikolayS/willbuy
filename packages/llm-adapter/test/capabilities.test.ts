import { describe, expect, it } from 'vitest';

import {
  LocalCliProvider,
  LOCAL_CLI_CAPABILITIES,
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_DEFAULT_TIMEOUT_MS,
  LOCAL_CLI_DEFAULT_BACKOFF_MS,
  LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS,
} from '../src/index.js';

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

  // Issue #23 / B1 (spec §5.15 line 253, §5.1 step 7 line 131, §2 #15):
  // logical_request_key embeds the model component. The provider — not the
  // caller — owns the model identity (mirrors how it owns name() and
  // capabilities()), so callers (visitor-worker, future spend ledger,
  // reconciliation job) can compute a key that matches the on-wire request.
  it('reports a stable, generic model() identifier that does not leak vendor identifiers', () => {
    const model = new LocalCliProvider().model();
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
    expect(model).not.toMatch(/anthropic|claude|openai|gpt|gemini/i);
  });

  it('honors WILLBUY_LLM_MODEL env var for model() identifier', () => {
    const prev = process.env.WILLBUY_LLM_MODEL;
    process.env.WILLBUY_LLM_MODEL = 'local-cli/v2-canary';
    try {
      expect(new LocalCliProvider().model()).toBe('local-cli/v2-canary');
    } finally {
      if (prev === undefined) {
        delete process.env.WILLBUY_LLM_MODEL;
      } else {
        process.env.WILLBUY_LLM_MODEL = prev;
      }
    }
  });
});

// ── Transport protocol constants — spec §5.15 pin ────────────────────────────

describe('LocalCliProvider — transport protocol constants (spec §5.15)', () => {
  it('LOCAL_CLI_PROVIDER_NAME is "local-cli" (generic, no vendor leak)', () => {
    expect(LOCAL_CLI_PROVIDER_NAME).toBe('local-cli');
  });

  it('LOCAL_CLI_DEFAULT_MODEL is "local-cli/v1" (generic identifier)', () => {
    expect(LOCAL_CLI_DEFAULT_MODEL).toBe('local-cli/v1');
  });

  it('LOCAL_CLI_DEFAULT_TIMEOUT_MS is 120_000 (2 minutes, spec §2 #6 cap)', () => {
    expect(LOCAL_CLI_DEFAULT_TIMEOUT_MS).toBe(120_000);
  });

  it('LOCAL_CLI_DEFAULT_BACKOFF_MS is [500, 2000, 8000] (exponential per §5.15)', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS).toEqual([500, 2000, 8000]);
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS).toHaveLength(3);
  });

  it('LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS is 3 (matching backoff array length)', () => {
    expect(LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS).toBe(3);
    // Invariant: backoff array has exactly (max_attempts - 1) entries.
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS).toHaveLength(LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS - 1 + 1);
  });
});
