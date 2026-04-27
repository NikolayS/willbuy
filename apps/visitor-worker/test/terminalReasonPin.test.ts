/**
 * terminalReasonPin.test.ts — spec-pin for terminal_reason SQL string values
 * written by visitor-worker/src/poller.ts (spec §5.11, §2 #12).
 *
 * The visitor-worker poller writes three distinct terminal_reason values
 * into the `visits` table on failure paths:
 *
 *   'no_snapshot'       — a11y_object_key is NULL; the capture was never
 *                         linked to this visit (broker storage race or
 *                         capture failure before broker write).
 *   'backstory_invalid' — the backstory_payload JSON fails Backstory schema
 *                         validation; visit cannot be scored.
 *   '<failure_reason>'  — 'schema' or 'transport' from runVisit(), passed
 *                         through as the terminal_reason.
 *
 * Existing coverage on main (poller.test.ts):
 *   - 'backstory_invalid' IS implicitly pinned at line 395:
 *       `q.includes('terminal_reason') && q.includes('backstory_invalid')`
 *   - 'no_snapshot' is NOT pinned; the test at line 162 only checks
 *       `q.includes('terminal_reason')` — any string would pass.
 *
 * Risk: renaming 'no_snapshot' → 'missing_snapshot' in the SQL would break
 * alerting rules that filter `terminal_reason = 'no_snapshot'` with no
 * other test catching the mismatch.
 *
 * We pin via source-text since poller.ts uses these strings inside SQL
 * template literals (not named constants), following the pattern of
 * PRs #441–#449.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'poller.ts'), 'utf8');

describe('visitor-worker terminal_reason SQL values spec-pin (spec §5.11)', () => {
  it("'no_snapshot' is used as a terminal_reason SQL value", () => {
    // Matches the UPDATE visits SET terminal_reason = 'no_snapshot' writes.
    expect(src).toMatch(/terminal_reason\s*=\s*'no_snapshot'/);
  });

  it("'no_snapshot' appears at least twice (both a11y_object_key null paths)", () => {
    const count = (src.match(/terminal_reason\s*=\s*'no_snapshot'/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("'backstory_invalid' is used as a terminal_reason SQL value", () => {
    expect(src).toMatch(/terminal_reason\s*=\s*'backstory_invalid'/);
  });
});
