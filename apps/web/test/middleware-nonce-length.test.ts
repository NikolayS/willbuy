/**
 * middleware-nonce-length.test.ts — pin nonce length and entropy properties
 * (spec §5.10 / amendment A9, issue #135).
 *
 * The existing middleware.test.ts verifies nonce format (URL-safe chars)
 * and distinctness across requests, but does not pin:
 *  - The nonce length (24 chars = btoa(16 random bytes), spec comment
 *    "16 random bytes → 24-character base64; comfortably above the
 *    'sufficiently random' bar (CSP3 SHOULD be >= 128 bits of entropy)")
 *  - That the nonce appears verbatim in the x-nonce response header
 *    AND inside the script-src 'nonce-<value>' directive (same request)
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

function reqFor(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

describe('CSP nonce — length and entropy (spec §5.10 / A9, issue #135)', () => {
  it('x-nonce header is exactly 24 chars (btoa of 16 random bytes)', () => {
    const res = middleware(reqFor('/dashboard/x'));
    const nonce = res.headers.get('x-nonce') ?? '';
    // btoa(16 bytes) = ceil(16/3)*4 = 24 characters (with = padding)
    expect(nonce.length).toBe(24);
  });

  it('nonce in x-nonce header matches the nonce in script-src CSP directive', () => {
    const res = middleware(reqFor('/r/abc'));
    const nonce = res.headers.get('x-nonce') ?? '';
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`'nonce-${nonce}'`);
  });

  it('nonce is non-empty', () => {
    const res = middleware(reqFor('/dashboard/y'));
    expect(res.headers.get('x-nonce')).not.toBe('');
    expect(res.headers.get('x-nonce')).not.toBeNull();
  });
});
