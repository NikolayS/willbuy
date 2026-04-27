// @vitest-environment jsdom
//
// Direct unit tests for getStudy() and createStudy() in lib/api-client.ts.
//
// The functions are exercised indirectly by components, but the schema-mismatch
// path and the network-error path are not covered there. These tests verify
// the full ApiResult discriminated union contract:
//   { ok: true; data: T }  |  { ok: false; status: number; error: string }

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStudy, createStudy } from '../lib/api-client';

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_STUDY_RESPONSE = {
  id: 42,
  status: 'visiting',
  visit_progress: { ok: 5, failed: 0, total: 30 },
  started_at: new Date().toISOString(),
  finalized_at: null,
};

describe('getStudy()', () => {
  it('returns { ok: true, data } when API returns a valid 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_STUDY_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await getStudy(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(42);
      expect(result.data.status).toBe('visiting');
    }
  });

  it('returns { ok: false, status: 0 } on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await getStudy(99);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.error).toContain('ECONNREFUSED');
    }
  });

  it('returns { ok: false, status: 401 } with error from JSON body on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'session expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await getStudy(7);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe('session expired');
    }
  });

  it('returns schema mismatch error when response shape is wrong', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42 }), {
        // Missing required fields like status, visit_progress, started_at.
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await getStudy(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/response shape mismatch/i);
      expect(result.status).toBe(200);
    }
  });
});

describe('createStudy()', () => {
  it('returns { ok: true, data } on 201 created', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ study_id: 17, status: 'capturing' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await createStudy({
      urls: ['https://example.com/pricing'],
      icp: { preset_id: 'saas_founder_pre_pmf' },
      n_visits: 30,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.study_id).toBe(17);
    }
  });

  it('returns { ok: false, status: 402 } on cap exceeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'daily spend cap exceeded' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await createStudy({
      urls: ['https://example.com/pricing'],
      icp: { preset_id: 'saas_founder_pre_pmf' },
      n_visits: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.error).toBe('daily spend cap exceeded');
    }
  });

  it('falls back to HTTP status text when error body has no error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const result = await createStudy({
      urls: ['https://example.com/pricing'],
      icp: { preset_id: 'saas_founder_pre_pmf' },
      n_visits: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toMatch(/HTTP 500/);
    }
  });
});
