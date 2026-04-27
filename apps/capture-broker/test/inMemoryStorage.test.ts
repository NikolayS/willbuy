/**
 * inMemoryStorage.test.ts — unit tests for the in-memory object storage
 * double (spec §5.13 object storage interface).
 *
 * inMemoryStorage() is used as the test double throughout server.test.ts
 * but its own contract (put/get/has round-trip, missing key throws, debug
 * list, isolation between instances) was never directly tested.
 */

import { describe, it, expect } from 'vitest';
import { inMemoryStorage } from '../src/storage.js';

describe('inMemoryStorage()', () => {
  it('has() returns false for a key that was never put', async () => {
    const s = inMemoryStorage();
    expect(await s.has('no/such/key')).toBe(false);
  });

  it('put() then has() returns true', async () => {
    const s = inMemoryStorage();
    await s.put('captures/test/a11y.json', Buffer.from('{}'), 'application/json');
    expect(await s.has('captures/test/a11y.json')).toBe(true);
  });

  it('put() then get() returns the same bytes', async () => {
    const s = inMemoryStorage();
    const data = Buffer.from('hello storage');
    await s.put('k', data, 'text/plain');
    const back = await s.get('k');
    expect(back.equals(data)).toBe(true);
  });

  it('get() throws for a key that was never put', async () => {
    const s = inMemoryStorage();
    await expect(s.get('missing/key')).rejects.toThrow('object not found');
  });

  it('put() stores a defensive copy — mutating the original buffer does not affect the stored value', async () => {
    const s = inMemoryStorage();
    const buf = Buffer.from([0x01, 0x02, 0x03]);
    await s.put('k', buf, 'application/octet-stream');
    buf[0] = 0xff; // mutate the original
    const back = await s.get('k');
    expect(back[0]).toBe(0x01); // stored copy unchanged
  });

  it('__debugList() returns all stored keys with metadata', async () => {
    const s = inMemoryStorage();
    await s.put('a.json', Buffer.from('{}'), 'application/json');
    await s.put('b.png', Buffer.alloc(10), 'image/png');
    const list = s.__debugList();
    expect(list).toHaveLength(2);
    const aEntry = list.find((e) => e.key === 'a.json');
    expect(aEntry!.contentType).toBe('application/json');
    expect(aEntry!.size).toBe(2); // '{}'
  });

  it('two instances are independent', async () => {
    const a = inMemoryStorage();
    const b = inMemoryStorage();
    await a.put('k', Buffer.from('a'), 'text/plain');
    expect(await b.has('k')).toBe(false);
  });
});
