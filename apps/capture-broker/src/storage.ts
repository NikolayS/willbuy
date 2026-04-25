/**
 * Storage abstraction — production binds this to the Supabase Storage
 * client; tests pass `inMemoryStorage()`. The broker code only ever sees
 * the interface, so CI never needs a live Supabase backend (per issue
 * #32 coordination note).
 */
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
