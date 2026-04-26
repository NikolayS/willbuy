/**
 * email/resend.ts — Resend transactional email client (issue #79).
 *
 * Spec refs: §2 #26 (Resend for transactional email), §4.1 (stack).
 *
 * When RESEND_TEST_MODE=stub the client logs the payload instead of
 * making a network call. Set this in tests via env so no real emails
 * are sent in CI / local dev.
 */

import { Resend } from 'resend';

export interface MagicLinkEmailOptions {
  to: string;
  verifyUrl: string;
}

export interface CapWarningEmailOptions {
  to: string;          // account owner email
  account_id: string;
  current_cents: number;
  cap_cents: number;
  study_id: string;
}

export interface ResendClient {
  sendMagicLink(opts: MagicLinkEmailOptions): Promise<void>;
  sendCapWarning(opts: CapWarningEmailOptions): Promise<void>;
  /** Number of times sendMagicLink was called — useful in test assertions. */
  callCount: number;
}

/**
 * Build a ResendClient. The testMode flag (or RESEND_TEST_MODE=stub env var)
 * makes the client log instead of sending. Tests inject testMode=true.
 */
export function buildResendClient(opts: {
  apiKey: string;
  testMode: boolean;
}): ResendClient {
  // Treat missing or placeholder keys as stub mode to avoid throwing at boot time.
  const isPlaceholder = !opts.apiKey || opts.apiKey === 're_not_configured';
  const effectiveTestMode = opts.testMode || isPlaceholder;
  const client = effectiveTestMode ? null : new Resend(opts.apiKey);
  // Shadow opts.testMode with the effective value for the closure below.
  const testMode = effectiveTestMode;
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    async sendMagicLink({ to, verifyUrl }: MagicLinkEmailOptions): Promise<void> {
      callCount += 1;

      if (testMode || !client) {
        // Stub mode: log so developers/tests can see what would be sent.
        console.log('[resend-stub] sendMagicLink', { to, verifyUrl });
        return;
      }

      const result = await client.emails.send({
        from: 'willbuy.dev <auth@willbuy.dev>',
        to,
        subject: 'Sign in to willbuy.dev',
        text: [
          'Click the link below to sign in to willbuy.dev.',
          '',
          verifyUrl,
          '',
          'This link expires in 30 minutes and can only be used once.',
          '',
          'If you did not request this, ignore this email.',
        ].join('\n'),
        html: [
          '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">',
          '<h2 style="color:#111">Sign in to willbuy.dev</h2>',
          '<p>Click the button below to sign in. This link expires in <strong>30 minutes</strong> and can only be used once.</p>',
          `<p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Sign in</a></p>`,
          '<p style="color:#666;font-size:13px">If you did not request this, you can safely ignore this email.</p>',
          '</body></html>',
        ].join(''),
      });

      if (result.error) {
        throw new Error(`Resend error: ${result.error.message}`);
      }
    },

    async sendCapWarning(opts: CapWarningEmailOptions): Promise<void> {
      if (testMode || !client) {
        console.log('[resend-stub] sendCapWarning', opts);
        return;
      }

      const currentDollars = (opts.current_cents / 100).toFixed(2);
      const capDollars = (opts.cap_cents / 100).toFixed(2);

      const result = await client.emails.send({
        from: 'alerts@willbuy.dev',
        to: opts.to,
        subject: 'Daily cap 50% warning — willbuy.dev',
        html: [
          '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">',
          '<h2 style="color:#b45309">Daily spend cap 50% warning</h2>',
          '<p>Your account has reached <strong>50% of its daily spend cap</strong>.</p>',
          '<table style="border-collapse:collapse;width:100%">',
          `<tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280">Account ID</td><td style="padding:8px;border:1px solid #e5e7eb">${opts.account_id}</td></tr>`,
          `<tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280">Study ID</td><td style="padding:8px;border:1px solid #e5e7eb">${opts.study_id}</td></tr>`,
          `<tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280">Current spend</td><td style="padding:8px;border:1px solid #e5e7eb">$${currentDollars} (${opts.current_cents}¢)</td></tr>`,
          `<tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280">Daily cap</td><td style="padding:8px;border:1px solid #e5e7eb">$${capDollars} (${opts.cap_cents}¢)</td></tr>`,
          '</table>',
          '<p style="color:#666;font-size:13px;margin-top:16px">New studies will be blocked once the daily cap is reached. To increase your cap, contact support.</p>',
          '</body></html>',
        ].join(''),
      });

      if (result.error) {
        throw new Error(`Resend error: ${result.error.message}`);
      }
    },
  };
}
