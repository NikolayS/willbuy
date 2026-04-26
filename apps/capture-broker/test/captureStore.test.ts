/**
 * pgCaptureStore unit tests — verifies upsert behaviour on
 * (study_id, COALESCE(side, '')) conflict (spec §5.13 / issue #166).
 *
 * Uses a mock Pool so no live database is required (per issue #32 coordination note).
 */
import { describe, it, expect, vi } from 'vitest';
import { pgCaptureStore, type PageCaptureRow } from '../src/captureStore.js';
import type { Pool } from 'pg';

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

/** Build a minimal Pool mock whose query() returns the given rows. */
function mockPool(rows: { id: string }[]): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool;
}

describe('pgCaptureStore', () => {
  it('throws when study_id is missing', async () => {
    const pool = mockPool([{ id: '1' }]);
    const store = pgCaptureStore(pool);
    const row = makeRow({ study_id: undefined });
    await expect(store.insert(row)).rejects.toThrow('study_id is required');
  });

  it('throws when url_hash is missing', async () => {
    const pool = mockPool([{ id: '1' }]);
    const store = pgCaptureStore(pool);
    const row = makeRow({ url_hash: undefined });
    await expect(store.insert(row)).rejects.toThrow('url_hash is required');
  });

  it('returns the id from the RETURNING clause', async () => {
    const pool = mockPool([{ id: '42' }]);
    const store = pgCaptureStore(pool);
    const result = await store.insert(makeRow());
    expect(result).toEqual({ id: 42 });
  });

  it('SQL contains ON CONFLICT clause for upsert', async () => {
    const pool = mockPool([{ id: '42' }]);
    const store = pgCaptureStore(pool);
    await store.insert(makeRow());

    const querySpy = vi.mocked(pool.query);
    expect(querySpy).toHaveBeenCalledOnce();
    const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('ON CONFLICT clause targets the correct partial index expression', async () => {
    const pool = mockPool([{ id: '42' }]);
    const store = pgCaptureStore(pool);
    await store.insert(makeRow());

    const querySpy = vi.mocked(pool.query);
    const [sql] = querySpy.mock.calls[0] as [string, unknown[]];
    // Must exactly match the unique index: (study_id, (COALESCE(side, ''::text)))
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*study_id\s*,\s*\(COALESCE\(side/);
  });

  // Core regression test for issue #166:
  // Two visits to the same single-URL study share the same study_id + NULL side.
  // The second INSERT must upsert (not fail) and return the same row id.
  it('upsert — two inserts with the same study_id return the same id (no unique violation)', async () => {
    // Both calls return the same row id, as Postgres would after an upsert.
    const pool = mockPool([{ id: '42' }]);
    const store = pgCaptureStore(pool);

    const rowA = makeRow({ study_id: 99, url_hash: 'hash-a', capture_id: 'cap-a' });
    const rowB = makeRow({ study_id: 99, url_hash: 'hash-b', capture_id: 'cap-b' });

    const first = await store.insert(rowA);
    // Reset the mock so the second call also returns the same existing id.
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '42' }] });
    const second = await store.insert(rowB);

    expect(first).toEqual({ id: 42 });
    expect(second).toEqual({ id: 42 });

    // Both calls must have used an upsert SQL (not a plain INSERT).
    const calls = vi.mocked(pool.query).mock.calls;
    for (const call of calls) {
      const sql = call[0] as string;
      expect(sql).toContain('ON CONFLICT');
    }
  });
});
