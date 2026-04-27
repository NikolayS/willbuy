/**
 * resend.test.ts — unit tests for buildResendClient() (email/resend.ts).
 *
 * The module has two key invariants not covered by integration tests:
 *   1. testMode=true and placeholder key both activate stub mode (no real Resend call).
 *   2. callCount increments on sendMagicLink regardless of mode.
 *   3. Stub mode does not throw even with a placeholder/missing API key.
 *
 * We do NOT test the real Resend API path (it requires a live key and hits
 * the network). Stub mode is the only path exercisable in unit tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildResendClient } from '../src/email/resend.js';

describe('buildResendClient() — stub mode', () => {
  it('does not throw when called with testMode=true', () => {
    expect(() =>
      buildResendClient({ apiKey: 're_test_dummy', testMode: true }),
    ).not.toThrow();
  });

  it('does not throw when apiKey is "re_not_configured" (placeholder key)', () => {
    expect(() =>
      buildResendClient({ apiKey: 're_not_configured', testMode: false }),
    ).not.toThrow();
  });

  it('does not throw when apiKey is empty string', () => {
    expect(() =>
      buildResendClient({ apiKey: '', testMode: false }),
    ).not.toThrow();
  });

  it('sendMagicLink resolves without error in stub mode', async () => {
    const client = buildResendClient({ apiKey: 're_test_dummy', testMode: true });
    await expect(
      client.sendMagicLink({ to: 'user@example.com', verifyUrl: 'https://example.com/verify?token=abc' }),
    ).resolves.toBeUndefined();
  });

  it('sendCapWarning resolves without error in stub mode', async () => {
    const client = buildResendClient({ apiKey: 're_test_dummy', testMode: true });
    await expect(
      client.sendCapWarning({
        to: 'user@example.com',
        account_id: '42',
        current_cents: 5000,
        cap_cents: 10000,
        study_id: '7',
      }),
    ).resolves.toBeUndefined();
  });

  it('callCount starts at 0', () => {
    const client = buildResendClient({ apiKey: 're_test_dummy', testMode: true });
    expect(client.callCount).toBe(0);
  });

  it('callCount increments after each sendMagicLink call', async () => {
    const client = buildResendClient({ apiKey: 're_test_dummy', testMode: true });
    await client.sendMagicLink({ to: 'a@example.com', verifyUrl: 'https://x.com/v?t=1' });
    expect(client.callCount).toBe(1);
    await client.sendMagicLink({ to: 'b@example.com', verifyUrl: 'https://x.com/v?t=2' });
    expect(client.callCount).toBe(2);
  });

  it('placeholder key "re_not_configured" activates stub mode (sendMagicLink does not call real Resend)', async () => {
    // If the placeholder key ever reaches the real Resend SDK, it would throw
    // with an auth error. Stub mode swallows the call — no throw means stub is active.
    const client = buildResendClient({ apiKey: 're_not_configured', testMode: false });
    await expect(
      client.sendMagicLink({ to: 'x@example.com', verifyUrl: 'https://x.com/v?t=x' }),
    ).resolves.toBeUndefined();
  });
});
