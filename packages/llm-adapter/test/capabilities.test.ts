import { describe, expect, it } from 'vitest';

import {
  LocalCliProvider,
  LOCAL_CLI_CAPABILITIES,
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
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

// ── Provider name + default model spec-pin (issue #5, spec §2 #27) ──────────
//
// LOCAL_CLI_PROVIDER_NAME and LOCAL_CLI_DEFAULT_MODEL are the identity
// anchors for the local-cli adapter. They must remain stable across versions
// so the logical_request_key computed by callers stays deterministic.

describe('LLM adapter name + default model spec-pins (issue #5)', () => {
  it('LOCAL_CLI_PROVIDER_NAME is "local-cli"', () => {
    expect(LOCAL_CLI_PROVIDER_NAME).toBe('local-cli');
  });

  it('LOCAL_CLI_DEFAULT_MODEL is "local-cli/v1"', () => {
    expect(LOCAL_CLI_DEFAULT_MODEL).toBe('local-cli/v1');
  });

  it('provider.name() returns LOCAL_CLI_PROVIDER_NAME', () => {
    expect(new LocalCliProvider().name()).toBe(LOCAL_CLI_PROVIDER_NAME);
  });

  it('provider.model() returns LOCAL_CLI_DEFAULT_MODEL when env var is unset', () => {
    const prev = process.env.WILLBUY_LLM_MODEL;
    delete process.env.WILLBUY_LLM_MODEL;
    try {
      expect(new LocalCliProvider().model()).toBe(LOCAL_CLI_DEFAULT_MODEL);
    } finally {
      if (prev !== undefined) process.env.WILLBUY_LLM_MODEL = prev;
    }
  });
});
