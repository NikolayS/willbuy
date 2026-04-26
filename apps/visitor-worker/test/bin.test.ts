/**
 * bin.test.ts — unit tests for the createVisitorWorker factory (spec §5.1, §5.11).
 *
 * We test the exported `createVisitorWorker` factory rather than spawning the
 * process entrypoint directly, which avoids needing a pre-built dist/ and keeps
 * the suite fast (no subprocesses, no real Postgres).
 */

import { describe, it, expect } from 'vitest';
import { createVisitorWorker } from '../src/bin.js';

describe('createVisitorWorker — env validation', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => createVisitorWorker({})).toThrow('DATABASE_URL is required');
  });

  it('throws when DATABASE_URL is an empty string', () => {
    expect(() => createVisitorWorker({ DATABASE_URL: '' })).toThrow('DATABASE_URL is required');
  });
});

describe('createVisitorWorker — wiring', () => {
  it('returns pool, storage, and provider when DATABASE_URL is set', () => {
    const result = createVisitorWorker({
      DATABASE_URL: 'postgresql://localhost:5432/test',
    });

    expect(result).toHaveProperty('pool');
    expect(result).toHaveProperty('storage');
    expect(result).toHaveProperty('provider');

    // Tear down the pool (no real connection needed for this check).
    void result.pool.end();
  });

  it('storage.put throws read-only error', async () => {
    const { pool, storage } = createVisitorWorker({
      DATABASE_URL: 'postgresql://localhost:5432/test',
    });

    await expect(storage.put('key', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'visitor-worker storage is read-only',
    );

    void pool.end();
  });

  it('provider exposes name() and model()', () => {
    const { pool, provider } = createVisitorWorker({
      DATABASE_URL: 'postgresql://localhost:5432/test',
    });

    expect(typeof provider.name()).toBe('string');
    expect(typeof provider.model()).toBe('string');

    void pool.end();
  });
});
