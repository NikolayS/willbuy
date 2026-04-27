/**
 * storage.test.ts — unit tests for inMemoryStorage and localFileStorage.
 *
 * inMemoryStorage: no I/O, pure in-memory map.
 * localFileStorage: uses a tmp directory (cleaned up by afterEach).
 *
 * Both implementations must satisfy the ObjectStorage interface contract.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { inMemoryStorage, localFileStorage } from '../src/storage.js';

// ── inMemoryStorage ───────────────────────────────────────────────────────────

describe('inMemoryStorage — put/get round-trip', () => {
  it('stores and retrieves bytes by key', async () => {
    const store = inMemoryStorage();
    const body = Buffer.from('hello world');
    await store.put('test/key.json', body, 'application/json');
    const result = await store.get('test/key.json');
    expect(result.toString()).toBe('hello world');
  });

  it('returns a copy of the stored buffer (not the same reference)', async () => {
    const store = inMemoryStorage();
    const body = Buffer.from([1, 2, 3]);
    await store.put('test/binary', body, 'application/octet-stream');
    const result = await store.get('test/binary');
    expect(result).not.toBe(body);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it('overwrites an existing key on second put', async () => {
    const store = inMemoryStorage();
    await store.put('key', Buffer.from('v1'), 'text/plain');
    await store.put('key', Buffer.from('v2'), 'text/plain');
    const result = await store.get('key');
    expect(result.toString()).toBe('v2');
  });

  it('stores multiple distinct keys independently', async () => {
    const store = inMemoryStorage();
    await store.put('a', Buffer.from('A'), 'text/plain');
    await store.put('b', Buffer.from('B'), 'text/plain');
    expect((await store.get('a')).toString()).toBe('A');
    expect((await store.get('b')).toString()).toBe('B');
  });
});

describe('inMemoryStorage — get throws for missing key', () => {
  it('throws Error with "object not found" when key does not exist', async () => {
    const store = inMemoryStorage();
    await expect(store.get('no-such-key')).rejects.toThrow('object not found');
  });

  it('throws after a key was put and then the store is fresh (no cross-instance leak)', async () => {
    const store1 = inMemoryStorage();
    const store2 = inMemoryStorage();
    await store1.put('key', Buffer.from('data'), 'text/plain');
    await expect(store2.get('key')).rejects.toThrow('object not found');
  });
});

describe('inMemoryStorage — has()', () => {
  it('returns false for a missing key', async () => {
    const store = inMemoryStorage();
    expect(await store.has('missing')).toBe(false);
  });

  it('returns true after a key is put', async () => {
    const store = inMemoryStorage();
    await store.put('exists', Buffer.from('x'), 'text/plain');
    expect(await store.has('exists')).toBe(true);
  });
});

describe('inMemoryStorage — __debugList()', () => {
  it('returns empty array when nothing is stored', () => {
    const store = inMemoryStorage();
    expect(store.__debugList()).toEqual([]);
  });

  it('lists stored objects with key, contentType, and byte size', async () => {
    const store = inMemoryStorage();
    await store.put('obj/a.json', Buffer.from('{"x":1}'), 'application/json');
    await store.put('obj/b.bin', Buffer.alloc(10), 'application/octet-stream');
    const list = store.__debugList();
    expect(list).toHaveLength(2);
    const a = list.find((e) => e.key === 'obj/a.json');
    expect(a?.contentType).toBe('application/json');
    expect(a?.size).toBe(7);
    const b = list.find((e) => e.key === 'obj/b.bin');
    expect(b?.size).toBe(10);
  });
});

// ── localFileStorage ──────────────────────────────────────────────────────────

describe('localFileStorage — put/get round-trip', () => {
  let tmpDir = '';

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  });

  it('writes and reads back bytes', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wb-storage-test-'));
    const store = localFileStorage(tmpDir);
    const body = Buffer.from('file contents');
    await store.put('sub/dir/file.txt', body, 'text/plain');
    const result = await store.get('sub/dir/file.txt');
    expect(result.toString()).toBe('file contents');
  });

  it('creates parent directories automatically', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wb-storage-test-'));
    const store = localFileStorage(tmpDir);
    // Deep nested path — directories must be created automatically.
    await store.put('a/b/c/d/e.bin', Buffer.from([0xff]), 'application/octet-stream');
    const result = await store.get('a/b/c/d/e.bin');
    expect(Array.from(result)).toEqual([0xff]);
  });

  it('has() returns true for an existing file', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wb-storage-test-'));
    const store = localFileStorage(tmpDir);
    await store.put('check.json', Buffer.from('{}'), 'application/json');
    expect(await store.has('check.json')).toBe(true);
  });

  it('has() returns false for a missing file', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wb-storage-test-'));
    const store = localFileStorage(tmpDir);
    expect(await store.has('no-such-file.json')).toBe(false);
  });

  it('get() throws for a missing file', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wb-storage-test-'));
    const store = localFileStorage(tmpDir);
    await expect(store.get('missing.bin')).rejects.toThrow();
  });
});
