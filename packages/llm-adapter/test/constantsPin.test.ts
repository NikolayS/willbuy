/**
 * constantsPin.test.ts — spec-pin for llm-adapter transport constants.
 *
 * capabilities.test.ts already tests capability flag types; transport-retry.test.ts
 * tests idempotency:false behavior. This file pins the numeric constants
 * that drive transport retry timing and the generic identifier strings
 * (no vendor names per CLAUDE.md / issue #5 discipline).
 *
 * Spec refs:
 *   §4.1   — LOCAL_CLI_DEFAULT_TIMEOUT_MS=120 000 ms (120 s subprocess timeout).
 *   §5.15  — LOCAL_CLI_DEFAULT_BACKOFF_MS=[500,2000,8000] jittered backoff.
 *   §5.15  — LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS=3.
 *   issue #5 — LOCAL_CLI_PROVIDER_NAME and LOCAL_CLI_DEFAULT_MODEL must not
 *              leak vendor identifiers.
 */

import { describe, it, expect } from 'vitest';
import {
  LOCAL_CLI_CAPABILITIES,
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_DEFAULT_TIMEOUT_MS,
  LOCAL_CLI_DEFAULT_BACKOFF_MS,
  LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS,
} from '../src/index.js';

describe('LOCAL_CLI capability flag values (spec §2 #27)', () => {
  it('idempotency is false', () => {
    expect(LOCAL_CLI_CAPABILITIES.idempotency).toBe(false);
  });

  it('zero_retention is false', () => {
    expect(LOCAL_CLI_CAPABILITIES.zero_retention).toBe(false);
  });

  it('structured_output is false', () => {
    expect(LOCAL_CLI_CAPABILITIES.structured_output).toBe(false);
  });

  it('prompt_caching is false', () => {
    expect(LOCAL_CLI_CAPABILITIES.prompt_caching).toBe(false);
  });
});

describe('LOCAL_CLI identifier strings (issue #5 — no vendor leaks)', () => {
  it('LOCAL_CLI_PROVIDER_NAME is "local-cli"', () => {
    expect(LOCAL_CLI_PROVIDER_NAME).toBe('local-cli');
  });

  it('LOCAL_CLI_DEFAULT_MODEL is "local-cli/v1"', () => {
    expect(LOCAL_CLI_DEFAULT_MODEL).toBe('local-cli/v1');
  });
});

describe('LOCAL_CLI transport constants (spec §4.1, §5.15)', () => {
  it('LOCAL_CLI_DEFAULT_TIMEOUT_MS is 120 000 ms (120 s)', () => {
    expect(LOCAL_CLI_DEFAULT_TIMEOUT_MS).toBe(120_000);
  });

  it('LOCAL_CLI_DEFAULT_BACKOFF_MS is [500, 2000, 8000]', () => {
    expect([...LOCAL_CLI_DEFAULT_BACKOFF_MS]).toEqual([500, 2000, 8000]);
  });

  it('backoff schedule has 3 entries matching MAX_TRANSPORT_ATTEMPTS', () => {
    expect(LOCAL_CLI_DEFAULT_BACKOFF_MS).toHaveLength(LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS);
  });

  it('LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS is 3', () => {
    expect(LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS).toBe(3);
  });
});
