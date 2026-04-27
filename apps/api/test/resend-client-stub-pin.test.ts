/**
 * resend-client-stub-pin.test.ts — unit tests for buildResendClient()
 * stub mode (spec §2 #26 / RESEND_TEST_MODE=stub).
 *
 * The stub path is used in all CI tests (RESEND_TEST_MODE=stub env var).
 * buildResendClient() itself is never directly tested — the auth.test.ts
 * creates its own hand-rolled stub. This file pins:
 *  - testMode=true → sendMagicLink() resolves without throwing
 *  - testMode=true → sendCapWarning() resolves without throwing
 *  - callCount increments on each sendMagicLink call
 *  - placeholder API key ('re_not_configured') forces stub mode even
 *    if testMode=false
 */

import { describe, it, expect } from 'vitest';
import { buildResendClient } from '../src/email/resend.js';

const STUB_OPTS = { apiKey: 're_stub_key', testMode: true };

describe('buildResendClient() stub mode (spec §2 #26)', () => {
  it('sendMagicLink resolves without throwing in stub mode', async () => {
    const client = buildResendClient(STUB_OPTS);
    await expect(
      client.sendMagicLink({ to: 'user@example.com', verifyUrl: 'https://x.test/verify' }),
    ).resolves.toBeUndefined();
  });

  it('sendCapWarning resolves without throwing in stub mode', async () => {
    const client = buildResendClient(STUB_OPTS);
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
    const client = buildResendClient(STUB_OPTS);
    expect(client.callCount).toBe(0);
  });

  it('callCount increments on each sendMagicLink call', async () => {
    const client = buildResendClient(STUB_OPTS);
    await client.sendMagicLink({ to: 'a@b.com', verifyUrl: 'https://x.test/v' });
    await client.sendMagicLink({ to: 'c@d.com', verifyUrl: 'https://x.test/v2' });
    expect(client.callCount).toBe(2);
  });

  it('placeholder API key forces stub mode (no Resend network call)', async () => {
    const client = buildResendClient({ apiKey: 're_not_configured', testMode: false });
    // If it tried a real call with this key it would throw; stub mode should succeed.
    await expect(
      client.sendMagicLink({ to: 'x@y.com', verifyUrl: 'https://test/v' }),
    ).resolves.toBeUndefined();
  });
});
