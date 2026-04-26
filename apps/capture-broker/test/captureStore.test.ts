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

    const querySpy = vi.mocked(pool.query);
    expect(querySpy).toHaveBeenCalledOnce();
    const [sql] = querySpy.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('ON CONFLICT targets (study_id, (COALESCE(side, …)))', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);
    await store.insert(makeRow());

    const [sql] = (vi.mocked(pool.query).mock.calls[0] as unknown as [string, unknown[]]);
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*study_id\s*,\s*\(COALESCE\(side/);
  });

  it('two inserts with the same study_id both return the same id (upsert, no unique violation)', async () => {
    const pool = mockPool('42');
    const store = pgCaptureStore(pool);

    const rowA = makeRow({ study_id: 99, url_hash: 'hash-a', capture_id: 'cap-a' });
    const rowB = makeRow({ study_id: 99, url_hash: 'hash-b', capture_id: 'cap-b' });

    const first = await store.insert(rowA);
    vi.mocked(pool.query).mockResolvedValueOnce(fakeResult('42') as unknown as void);
    const second = await store.insert(rowB);

    expect(first).toEqual({ id: 42 });
    expect(second).toEqual({ id: 42 });

    for (const call of vi.mocked(pool.query).mock.calls) {
      expect((call[0] as string)).toContain('ON CONFLICT');
    }
  });
});
