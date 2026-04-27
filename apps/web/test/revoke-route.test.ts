// @vitest-environment node
/**
 * revoke-route.test.ts — unit tests for the /dashboard/api-keys/:id/revoke
 * Route Handler (POST-only, issue #81, spec §5.10).
 *
 * The handler:
 *   1. Validates the id param is a positive integer regex.
 *   2. Forwards DELETE /api/api-keys/:id with session cookie.
 *   3. On fetch error → redirects with ?error= query param.
 *   4. On 401 → redirects to /sign-in.
 *   5. On 200/404 → redirects back to /dashboard/api-keys.
 *
 * All paths return 303 redirects (no body). We mock globalThis.fetch via
 * vi.stubGlobal and call the exported POST function directly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../app/dashboard/api-keys/[id]/revoke/route';

const BASE_URL = 'http://localhost';

function makeReq(id: string, cookie = 'wb_session=test'): [NextRequest, { params: { id: string } }] {
  const req = new NextRequest(`${BASE_URL}/dashboard/api-keys/${id}/revoke`, {
    method: 'POST',
    headers: { cookie },
  });
  return [req, { params: { id } }];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Invalid ID (non-integer) → redirect to list ────────────────────────────

describe('POST /dashboard/api-keys/:id/revoke — invalid id', () => {
  it('non-numeric id → 303 to /dashboard/api-keys (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const [req, ctx] = makeReq('abc');
    const res = await POST(req, ctx);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE_URL}/dashboard/api-keys`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('zero → 303 to /dashboard/api-keys (not a positive integer)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const [req, ctx] = makeReq('0');
    const res = await POST(req, ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE_URL}/dashboard/api-keys`);
  });

  it('negative id → 303 to list', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const [req, ctx] = makeReq('-5');
    const res = await POST(req, ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE_URL}/dashboard/api-keys`);
  });
});

// ── API unreachable → redirect with error message ─────────────────────────

describe('POST — API unreachable', () => {
  it('fetch throws → 303 with ?error= in location', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const [req, ctx] = makeReq('42');
    const res = await POST(req, ctx);

    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/dashboard/api-keys');
    expect(loc).toContain('error=');
    expect(decodeURIComponent(loc)).toContain('unreachable');
  });
});

// ── 401 from API → redirect to sign-in ────────────────────────────────────

describe('POST — 401 from API', () => {
  it('API returns 401 → 303 to /sign-in with redirect param', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const [req, ctx] = makeReq('7');
    const res = await POST(req, ctx);

    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/sign-in');
    expect(loc).toContain('redirect');
  });
});

// ── 200 / 404 → redirect back to list ─────────────────────────────────────

describe('POST — successful revoke (200 or 404)', () => {
  it('API returns 200 → 303 to /dashboard/api-keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const [req, ctx] = makeReq('3');
    const res = await POST(req, ctx);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE_URL}/dashboard/api-keys`);
  });

  it('API returns 404 → 303 to /dashboard/api-keys (already revoked is not an error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const [req, ctx] = makeReq('99');
    const res = await POST(req, ctx);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE_URL}/dashboard/api-keys`);
  });
});

// ── Cookie forwarding ─────────────────────────────────────────────────────

describe('POST — cookie forwarding', () => {
  it('forwards the cookie header to the API DELETE call', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const sessionCookie = 'wb_session=my-session-token';
    const [req, ctx] = makeReq('5', sessionCookie);
    await POST(req, ctx);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0]!;
    expect((opts as RequestInit).headers).toMatchObject({ cookie: sessionCookie });
  });
});
