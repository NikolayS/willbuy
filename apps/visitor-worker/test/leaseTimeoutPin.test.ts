/**
 * leaseTimeoutPin.test.ts — spec-pin for the 120s idle_in_transaction
 * session timeout in visitor-worker/src/poller.ts (spec §5.11, §2 #12).
 *
 * The poller sets `SET LOCAL idle_in_transaction_session_timeout = '120s'`
 * before holding the FOR UPDATE SKIP LOCKED row lock across the entire
 * LLM call. This bounds a wedged worker: if the LLM call hangs, Postgres
 * rolls back the transaction after 120 s, releasing the row lock for
 * re-lease by another worker.
 *
 * The timeout is a string literal inside a SQL template, not a named
 * constant, so no import is possible. We read the source as text and
 * assert the exact value, following the same pattern as fcp-budget-pin.
 *
 * Risk: changing '120s' to '600s' (10 min) would silently extend the
 * wedge window from 2 min to 10 min, delaying recovery for every visit
 * where the LLM call hangs — no other test would catch this.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pollerSrc = resolve(here, '..', 'src', 'poller.ts');

describe('visitor-worker lease timeout spec-pin (spec §5.11 / §2 #12)', () => {
  it('poller.ts source exists', () => {
    expect(() => readFileSync(pollerSrc, 'utf8')).not.toThrow();
  });

  it("idle_in_transaction_session_timeout is set to '120s' (not a looser value)", () => {
    const src = readFileSync(pollerSrc, 'utf8');
    // The exact SQL string that bounds wedged LLM calls.
    expect(src).toMatch(/idle_in_transaction_session_timeout\s*=\s*'120s'/);
  });

  it('the timeout SET appears inside a BEGIN transaction block (lease context)', () => {
    const src = readFileSync(pollerSrc, 'utf8');
    // Verify BEGIN precedes the actual SQL SET (not comments).
    // Use lastIndexOf on the SET call pattern to get the code occurrence.
    const beginIdx = src.indexOf("query('BEGIN')");
    const setIdx = src.indexOf("SET LOCAL idle_in_transaction_session_timeout");
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(beginIdx);
  });
});
