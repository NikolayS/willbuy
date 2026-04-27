// @vitest-environment node
/**
 * create-key-route.test.ts — unit tests for the /dashboard/api-keys/create
 * POST Route Handler (issue #81, spec §2 #22, §5.10).
 *
 * The handler:
 *   1. Missing/empty label → 303 to /dashboard/api-keys/new?error=…
 *   2. API unreachable → 303 with error message.
 *   3. 401 from API → 303 to /sign-in.
 *   4. API non-ok (e.g. 409 cap) → 303 with error from JSON body.
 *   5. Success (201) → 200 HTML with raw key, no-store cache, x-frame-options.
 *   6. esc() HTML-entity escaping: XSS chars in label/key are escaped.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../app/dashboard/api-keys/create/route';

const BASE_URL = 'http://localhost';

function makeFormReq(fields: Record<string, string>): NextRequest {
  const body = new URLSearchParams(fields).toString();
  return new NextRequest(`${BASE_URL}/dashboard/api-keys/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: 'wb_session=test',
    },
    body,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Empty label → redirect with error ─────────────────────────────────────

describe('POST /dashboard/api-keys/create — missing label', () => {
  it('empty label → 303 to /new?error=Label+is+required', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const req = makeFormReq({ label: '' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/dashboard/api-keys/new');
    expect(loc).toContain('error=');
    expect(decodeURIComponent(loc).toLowerCase()).toContain('required');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('whitespace-only label → 303 with error (trimmed to empty)', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const req = makeFormReq({ label: '   ' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('error=');
  });
});

// ── API unreachable ────────────────────────────────────────────────────────

describe('POST — API unreachable', () => {
  it('fetch throws → 303 with API-unreachable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/dashboard/api-keys/new');
    expect(loc).toContain('error=');
    expect(decodeURIComponent(loc).toLowerCase()).toContain('unreachable');
  });
});

// ── 401 → sign-in redirect ─────────────────────────────────────────────────

describe('POST — 401 from API', () => {
  it('API 401 → 303 to /sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, { status: 401 }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/sign-in');
  });
});

// ── API non-ok (e.g. 409 cap) → redirect with JSON error ──────────────────

describe('POST — API non-ok response', () => {
  it('API 409 with JSON error → 303 with that error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'maximum of 2 active keys' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    const loc = decodeURIComponent(res.headers.get('location') ?? '');
    expect(loc).toContain('maximum of 2 active keys');
  });

  it('API 500 without JSON body → redirect with status code in error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('error=');
    // Must include the status code so the user has diagnostic info.
    expect(decodeURIComponent(loc)).toContain('500');
  });
});

// ── Success → 200 HTML with security headers ─────────────────────────────

describe('POST — success (201 from API)', () => {
  const successBody = {
    id: 1,
    label: 'CI key',
    key: 'sk_live_' + 'A'.repeat(24),
    prefix: 'sk_live_A',
  };

  it('returns 200 with HTML content-type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('sets Cache-Control: no-store to prevent key being cached (§2 #22)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('sets X-Frame-Options: DENY to prevent iframe embedding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);

    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('includes the raw key in the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const req = makeFormReq({ label: 'CI key' });
    const res = await POST(req);
    const html = await res.text();

    expect(html).toContain(successBody.key);
    expect(html).toContain('Save this key now');
  });

  it('HTML-entity escapes XSS in label (esc() function, §5.10)', async () => {
    const xssBody = {
      id: 2,
      label: '<script>alert(1)</script>',
      key: 'sk_live_' + 'B'.repeat(24),
      prefix: 'sk_live_B',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(xssBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const req = makeFormReq({ label: 'harmless-label-at-form-time' });
    const res = await POST(req);
    const html = await res.text();

    // The XSS payload from the API response must be escaped.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
