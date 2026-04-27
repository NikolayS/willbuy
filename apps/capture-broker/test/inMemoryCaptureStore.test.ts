/**
 * inMemoryCaptureStore.test.ts — unit tests for the in-memory capture store.
 *
 * inMemoryCaptureStore() is used as the test/smoke double in server.test.ts
 * integration tests but its own contract was never directly tested:
 *  - insert() accumulates rows
 *  - rows() returns a snapshot (not the internal reference)
 *  - insert() always returns id=0 (no DB, spec contract)
 *  - multiple stores are independent
 */

import { describe, it, expect } from 'vitest';
import { inMemoryCaptureStore } from '../src/captureStore.js';
import type { PageCaptureRow } from '../src/captureStore.js';

function row(overrides: Partial<PageCaptureRow> = {}): PageCaptureRow {
  return {
    capture_id: 'cap-1',
    status: 'ok',
    a11y_object_key: 'captures/cap-1/a11y.json',
    screenshot_object_key: null,
    banner_selectors_matched: [],
    overlays_unknown_present: false,
    blocked_reason: null,
    host_count: 0,
    breach_reason: null,
    redactor_v: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('inMemoryCaptureStore()', () => {
  it('starts empty — rows() returns []', () => {
    const store = inMemoryCaptureStore();
    expect(store.rows()).toHaveLength(0);
  });

  it('insert() accumulates rows in order', async () => {
    const store = inMemoryCaptureStore();
    await store.insert(row({ capture_id: 'cap-1' }));
    await store.insert(row({ capture_id: 'cap-2' }));
    const rows = store.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.capture_id).toBe('cap-1');
    expect(rows[1]!.capture_id).toBe('cap-2');
  });

  it('insert() always returns id=0 (no DB)', async () => {
    const store = inMemoryCaptureStore();
    const result = await store.insert(row());
    expect(result.id).toBe(0);
  });

  it('rows() returns a snapshot — mutating the result does not affect the store', () => {
    const store = inMemoryCaptureStore();
    const snap = store.rows();
    snap.push(row({ capture_id: 'intruder' }));
    // The store's internal list is unchanged.
    expect(store.rows()).toHaveLength(0);
  });

  it('two stores are independent', async () => {
    const a = inMemoryCaptureStore();
    const b = inMemoryCaptureStore();
    await a.insert(row({ capture_id: 'cap-a' }));
    expect(a.rows()).toHaveLength(1);
    expect(b.rows()).toHaveLength(0);
  });
});
