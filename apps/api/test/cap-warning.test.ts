/**
 * cap-warning.test.ts — unit tests for maybeWarnCap (spec §5.6).
 *
 * The function has three distinct return paths, all testable with a mock
 * tagged-template sql function (no real DB needed):
 *
 *   1. new_cents < 50% of daily_cap → return false immediately (no DB call).
 *   2. DB INSERT ON CONFLICT returns zero rows (another caller won) → false.
 *   3. DB INSERT returns one row (this caller wins) → send email → true.
 *
 * Additionally:
 *   4. sendCapWarning throwing is caught and does NOT propagate (non-fatal).
 *   5. Exact 50% threshold: new_cents === daily_cap_cents * 0.5 → threshold
 *      crossed (≥, not >).
 *
 * No Docker, no Postgres connection, no real email.
 */

import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';

import { maybeWarnCap } from '../src/billing/cap-warning.js';
import type { ResendClient } from '../src/email/resend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock postgres tagged-template sql function that returns `rows`
 * for any query. No real DB connection.
 */
function mockSql(rows: unknown[]): ReturnType<typeof postgres> {
  const tag = async (_strings: TemplateStringsArray, ..._values: unknown[]) => rows;
  return tag as unknown as ReturnType<typeof postgres>;
}

function stubResend(): ResendClient & { capWarnCallCount: number } {
  let capWarnCallCount = 0;
  return {
    get capWarnCallCount() { return capWarnCallCount; },
    async sendMagicLink() { /* no-op */ },
    async sendCapWarning() { capWarnCallCount += 1; },
  };
}

const BASE = {
  account_id: 1n,
  date: '2026-04-27',
  daily_cap_cents: 10_000,
  owner_email: 'test@example.com',
  study_id: '42',
};

// ── Path 1: below threshold → false, no DB call ───────────────────────────────

describe('maybeWarnCap — below 50% threshold → false without DB call', () => {
  it('returns false when new_cents < 50% of daily_cap', async () => {
    let dbCalled = false;
    const sql = async (_s: TemplateStringsArray, ..._v: unknown[]) => {
      dbCalled = true;
      return [];
    };
    const resend = stubResend();

    const result = await maybeWarnCap({
      ...BASE,
      sql: sql as unknown as ReturnType<typeof postgres>,
      new_cents: 4_999, // 49.99% — below threshold
      resend,
    });

    expect(result).toBe(false);
    expect(dbCalled).toBe(false);
    expect(resend.capWarnCallCount).toBe(0);
  });

  it('returns false at 1 cent (well below threshold)', async () => {
    const resend = stubResend();
    const result = await maybeWarnCap({
      ...BASE,
      sql: mockSql([]),
      new_cents: 1,
      resend,
    });
    expect(result).toBe(false);
  });
});

// ── Path 1b: exactly 50% threshold → crosses into insert path ─────────────────

describe('maybeWarnCap — exact 50% threshold is crossed (≥, not >)', () => {
  it('returns true at exactly 50% (5000/10000)', async () => {
    const resend = stubResend();
    const result = await maybeWarnCap({
      ...BASE,
      sql: mockSql([{ account_id: '1' }]),
      new_cents: 5_000, // exactly 50%
      resend,
    });
    expect(result).toBe(true);
    expect(resend.capWarnCallCount).toBe(1);
  });

  it('returns true at 50% + 1 cent', async () => {
    const resend = stubResend();
    const result = await maybeWarnCap({
      ...BASE,
      sql: mockSql([{ account_id: '1' }]),
      new_cents: 5_001,
      resend,
    });
    expect(result).toBe(true);
  });
});

// ── Path 2: DB returns zero rows (race lost / already warned) → false ──────────

describe('maybeWarnCap — DB ON CONFLICT returns empty → false, no email', () => {
  it('returns false and does not call sendCapWarning when rows is empty', async () => {
    const resend = stubResend();
    const result = await maybeWarnCap({
      ...BASE,
      sql: mockSql([]), // empty = another caller already inserted
      new_cents: 6_000, // above threshold
      resend,
    });
    expect(result).toBe(false);
    expect(resend.capWarnCallCount).toBe(0);
  });
});

// ── Path 3: DB returns a row → send email → true ──────────────────────────────

describe('maybeWarnCap — DB inserts row → sendCapWarning called → true', () => {
  it('returns true and calls sendCapWarning with correct args', async () => {
    const resend = stubResend();
    const sendSpy = vi.spyOn(resend, 'sendCapWarning');

    const result = await maybeWarnCap({
      ...BASE,
      sql: mockSql([{ account_id: '1' }]),
      new_cents: 7_500,
      resend,
    });

    expect(result).toBe(true);
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: BASE.owner_email,
        current_cents: 7_500,
        cap_cents: BASE.daily_cap_cents,
        study_id: BASE.study_id,
      }),
    );
  });
});

// ── Path 4: sendCapWarning throws → non-fatal, returns true ───────────────────

describe('maybeWarnCap — sendCapWarning failure is non-fatal', () => {
  it('returns true even when sendCapWarning throws', async () => {
    const resend: ResendClient = {
      async sendMagicLink() { /* no-op */ },
      async sendCapWarning() {
        throw new Error('resend API down');
      },
    };

    const result = await maybeWarnCap({
      ...BASE,
      sql: mockSql([{ account_id: '1' }]),
      new_cents: 8_000,
      resend,
    });

    // Email error must not propagate — the function returns true because the
    // DB row was inserted (the idempotency invariant holds even if send fails).
    expect(result).toBe(true);
  });
});
