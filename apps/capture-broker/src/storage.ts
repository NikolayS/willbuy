/**
 * Storage abstraction — production binds this to local-fs storage; tests
 * pass `inMemoryStorage()`. The broker code only ever sees the interface,
 * so CI never needs a live storage backend (per issue #32 coordination note).
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
export type ObjectStorage = {
  /** Upload bytes; returns the canonical object key on success. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Read back; throws if missing. Used by tests to assert round-trip. */
  get(key: string): Promise<Buffer>;
  /** Cheap existence check (used in round-trip assertion). */
  has(key: string): Promise<boolean>;
};

export function inMemoryStorage(): ObjectStorage & {
  /** Test affordance: list every (key, contentType) pair currently stored. */
  __debugList(): Array<{ key: string; contentType: string; size: number }>;
} {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    async put(key, body, contentType) {
      objects.set(key, { body: Buffer.from(body), contentType });
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) throw new Error(`object not found: ${key}`);
      return o.body;
    },
    async has(key) {
      return objects.has(key);
    },
    __debugList() {
      return [...objects.entries()].map(([key, v]) => ({
        key,
        contentType: v.contentType,
        size: v.body.length,
      }));
    },
  };
}

/**
 * Production local-filesystem ObjectStorage implementation.
 *
 * Files are written under `basePath` using the object key as the relative
 * path (e.g. `captures/<id>/a11y.json`). Parent directories are created
 * automatically. Used in production when Supabase Storage is not yet wired.
 */
export function localFileStorage(basePath: string): ObjectStorage {
  return {
    async put(key: string, body: Buffer): Promise<void> {
      const dest = join(basePath, key);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
    },
    async get(key: string): Promise<Buffer> {
      return readFile(join(basePath, key));
    },
    async has(key: string): Promise<boolean> {
      try {
        await access(join(basePath, key));
        return true;
      } catch {
        return false;
      }
    },
  };
}
