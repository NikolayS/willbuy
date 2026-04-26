import { describe, it, expect, vi } from 'vitest';
import { pgCaptureStore, type PageCaptureRow } from '../src/captureStore.js';
import type { Pool, QueryResult } from 'pg';

function makeRow(overrides: Partial<PageCaptureRow> = {}): PageCaptureRow {
  return {
    capture_id: 'cap-test-1',
    status: 'ok',
    a11y_object_key: 'captures/cap-test-1/a11y.json',
    screenshot_object_key: null,
    banner_selectors_matched: [],
    overlays_unknown_present: false,
    blocked_reason: null,
    host_count: 2,
    breach_reason: null,
    redactor_v: 1,
    created_at: '2026-04-26T00:00:00.000Z',
    study_id: 7,
    url_hash: 'abc123',
    ...overrides,
  };
}

function fakeResult(id: string): QueryResult<{ id: string }> {
  return { rows: [{ id }], command: '', rowCount: 1, oid: 0, fields: [] };
}

function mockPool(id: string): Pool {
  return {
    query: vi.fn().mockResolvedValue(fakeResult(id)),
  } as unknown as Pool;
}

describe('pgCaptureStore', () => {
  it('throws when study_id is missing', async () => {
    const pool = mockPool('1');
    const store = pgCaptureStore(pool);
    // exactOptionalPropertyTypes: use unknown cast to simulate missing optional field
    const row = makeRow({ study_id: undefined as unknown as number });
    await expect(store.insert(row)).rejects.toThrow('study_id is required');
  });

  it('throws when url_hash is missing', async () => {
    const pool = mockPool('1');
    const store = pgCaptureStore(pool);
    const row = makeRow({ url_hash: undefined as unknown as string });
    await expect(store.insert(row)).rejects.toThrow('url_hash is required');
  });

  it('returns the numeric id from the RETURNING clause', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);
    const result = await store.insert(makeRow());
    expect(result).toEqual({ id: 42 });
  });

  it('SQL contains ON CONFLICT … DO UPDATE SET for upsert', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);
    await store.insert(makeRow());

    // pool.query is a vi.fn() — cast to access .mock directly (vi.mocked not available in Bun)
    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    expect(querySpy).toHaveBeenCalledOnce();
    const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('ON CONFLICT targets (study_id, (COALESCE(side, …)))', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);
    await store.insert(makeRow());

    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*study_id\s*,\s*\(COALESCE\(side/);
    // Must not contain ::text cast — index uses bare COALESCE(side, '')
    expect(sql).not.toContain("''::text");
  });

  it('side is included in the INSERT column list and bound as a param', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);
    await store.insert(makeRow({ side: 'A' }));

    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
    // Column list must include `side`
    expect(sql).toMatch(/\(\s*study_id\s*,\s*side\s*,/);
    // Params array must contain the side value ('A')
    expect(params).toContain('A');
  });

  it('side is NULL in params when absent (single-URL study)', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);
    // makeRow() has no side property — simulates single-URL study
    await store.insert(makeRow());

    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    const [, params] = querySpy.mock.calls[0] as [string, unknown[]];
    // Second param is side — must be null for single-URL studies
    expect(params[1]).toBeNull();
  });

  it('two inserts with the same study_id both return the same id (upsert, no unique violation)', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);

    const rowA = makeRow({ study_id: 99, url_hash: 'hash-a', capture_id: 'cap-a' });
    const rowB = makeRow({ study_id: 99, url_hash: 'hash-b', capture_id: 'cap-b' });

    const first = await store.insert(rowA);
    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    querySpy.mockResolvedValueOnce(fakeResult('42') as unknown as void);
    const second = await store.insert(rowB);

    expect(first).toEqual({ id: 42 });
    expect(second).toEqual({ id: 42 });

    for (const call of querySpy.mock.calls) {
      expect((call[0] as string)).toContain('ON CONFLICT');
    }
  });
});
