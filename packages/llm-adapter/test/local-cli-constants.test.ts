/**
 * local-cli-constants.test.ts — spec-pins for the LOCAL_CLI_* exported
 * constants in packages/llm-adapter/src/index.ts.
 *
 * LOCAL_CLI_PROVIDER_NAME='local-cli' (spec §4.1 + CLAUDE.md):
 *   Generic, vendor-neutral name. Changing it breaks callers that check
 *   provider.name() === LOCAL_CLI_PROVIDER_NAME, and may leak a vendor
 *   identifier that CLAUDE.md explicitly forbids in src/ identifiers.
 *
 * LOCAL_CLI_DEFAULT_MODEL='local-cli/v1' (spec §5.15 / §2 #15):
 *   Model component of the logical_request_key. Changing it silently
 *   invalidates the idempotency guarantees for all in-flight visits at
 *   deploy time (keys computed before the change won't match after).
 *
 * LOCAL_CLI_DEFAULT_TIMEOUT_MS=120000 (spec §4.1):
 *   Subprocess timeout. Lowering it causes spurious indeterminate results
 *   on slow hosts; raising it extends the blast radius of a hung process.
 *
 * LOCAL_CLI_DEFAULT_BACKOFF_MS=[500, 2000, 8000] (spec §5.15):
 *   Jittered backoff schedule for transport retries. The three entries
 *   encode the 0.5s → 2s → 8s doubling schedule. Any reordering or
 *   truncation silently changes retry timing for all transport failures.
 *
 * LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS=3 (spec §5.15):
 *   Cap at 3 transport attempts. Lowering to 1 removes the retry safety
 *   net; raising it without updating BACKOFF_MS creates out-of-bounds
 *   backoff lookups.
 *
 * LOCAL_CLI_CAPABILITIES (spec §2 #27 / issue #5):
 *   All four flags false for the v0.1 local CLI. Any silent flip to true
 *   would misrepresent the provider's idempotency or retention posture
 *   to callers that gate behavior on these flags.
 */

import { describe, expect, it } from 'vitest';
import {
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_DEFAULT_TIMEOUT_MS,
  LOCAL_CLI_DEFAULT_BACKOFF_MS,
  LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS,
  LOCAL_CLI_CAPABILITIES,
} from '../src/index.js';

describe('LOCAL_CLI_PROVIDER_NAME spec-pin', () => {
  it('is "local-cli" (generic, vendor-neutral per CLAUDE.md)', () => {
    expect(LOCAL_CLI_PROVIDER_NAME).toBe('local-cli');
  });

  it('does not contain any vendor identifier', () => {
    expect(LOCAL_CLI_PROVIDER_NAME).not.toMatch(/anthropic|claude|openai|gpt|gemini/i);
  });
});

describe('LOCAL_CLI_DEFAULT_MODEL spec-pin', () => {
  it('is "local-cli/v1"', () => {
    expect(LOCAL_CLI_DEFAULT_MODEL).toBe('local-cli/v1');
  });

  it('does not contain any vendor identifier', () => {
    expect(LOCAL_CLI_DEFAULT_MODEL).not.toMatch(/anthropic|claude|openai|gpt|gemini/i);
  });
});

describe('LOCAL_CLI_DEFAULT_TIMEOUT_MS spec-pin', () => {
  it('is 120000 ms (2 minutes per spec §4.1)', () => {
    expect(LOCAL_CLI_DEFAULT_TIMEOUT_MS).toBe(120_000);
    expect(LOCAL_CLI_DEFAULT_TIMEOUT_MS).toBe(2 * 60 * 1000);
  });
});

describe('LOCAL_CLI_DEFAULT_BACKOFF_MS spec-pin', () => {
  it('has exactly 3 entries', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS).toHaveLength(3);
  });

  it('first entry is 500 ms (wait before retry 2)', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS[0]).toBe(500);
  });

  it('second entry is 2000 ms (wait before retry 3)', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS[1]).toBe(2_000);
  });

  it('third entry is 8000 ms (spec §5.15 doubling schedule ceiling)', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS[2]).toBe(8_000);
  });

  it('schedule is monotonically increasing', () => {
    for (let i = 1; i < LOCAL_CLI_DEFAULT_BACKOFF_MS.length; i++) {
      expect(LOCAL_CLI_DEFAULT_BACKOFF_MS[i]!).toBeGreaterThan(
        LOCAL_CLI_DEFAULT_BACKOFF_MS[i - 1]!,
      );
    }
  });
});

describe('LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS spec-pin', () => {
  it('is 3 (cap per spec §5.15)', () => {
    expect(LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS).toBe(3);
  });

  it('backoff schedule has at least MAX_TRANSPORT_ATTEMPTS - 1 entries', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS.length).toBeGreaterThanOrEqual(
      LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS - 1,
    );
  });
});

describe('LOCAL_CLI_CAPABILITIES spec-pin', () => {
  it('idempotency is false (local CLI does not guarantee idempotency)', () => {
    expect(LOCAL_CLI_CAPABILITIES.idempotency).toBe(false);
  });

  it('zero_retention is false (spec §2 #33 — not confirmed for local CLI)', () => {
    expect(LOCAL_CLI_CAPABILITIES.zero_retention).toBe(false);
  });

  it('structured_output is false (spec §2 #27 — JSON mode not in v0.1)', () => {
    expect(LOCAL_CLI_CAPABILITIES.structured_output).toBe(false);
  });

  it('prompt_caching is false (spec §1 — not available in local CLI path)', () => {
    expect(LOCAL_CLI_CAPABILITIES.prompt_caching).toBe(false);
  });
});
