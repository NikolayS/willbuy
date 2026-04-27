/**
 * magic-link-token-entropy-pin.test.ts — spec-pin for the magic-link token
 * length in apps/api/src/routes/auth.ts (spec §2 #20, §2 #26).
 *
 * The magic-link token is generated as `nanoid(22)` — 22 characters from
 * nanoid's URL-safe alphabet (64 chars) ≈ 22 × log2(64) = 132 bits of
 * entropy. The comment in auth.ts says "22-char nanoid = 128 bits of entropy"
 * (conservative rounding). This length is the same as the domain-verification
 * token (TOKEN_LENGTH = 22 in domains.ts, which IS a named constant).
 *
 * The 22 in `nanoid(22)` is an inline literal with no named constant export.
 * Reducing it to e.g. `nanoid(16)` (96 bits) would silently weaken the
 * sign-in token entropy with no other test failing.
 *
 * Pin strategy: read auth.ts source text and assert the exact call form,
 * following the same pattern as PRs #441–#443.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const authSrc = resolve(here, '..', 'src', 'routes', 'auth.ts');

describe('magic-link token entropy spec-pin (spec §2 #20 / §2 #26)', () => {
  it('auth.ts source exists', () => {
    expect(() => readFileSync(authSrc, 'utf8')).not.toThrow();
  });

  it('magic-link raw token is generated with nanoid(22) — ≈128 bits of entropy', () => {
    const src = readFileSync(authSrc, 'utf8');
    // Asserts the exact call; catching a downgrade to nanoid(16) or similar.
    expect(src).toMatch(/nanoid\(22\)/);
  });

  it('the 22-char nanoid is assigned to rawToken before SHA-256 hashing', () => {
    const src = readFileSync(authSrc, 'utf8');
    // The token must be hashed (stored as sha256hex) — verify the store line
    // still follows the nanoid call in the same function.
    const nanoidIdx = src.indexOf('nanoid(22)');
    const hashIdx = src.indexOf('sha256hex(rawToken)');
    expect(nanoidIdx).toBeGreaterThanOrEqual(0);
    expect(hashIdx).toBeGreaterThan(nanoidIdx);
  });
});
