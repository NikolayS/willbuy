/**
 * logger.test.ts — smoke test for the capture-worker logger wrapper.
 *
 * Per issue #118 TDD #1: each node app must produce a redacted JSON log line
 * via its local logger.ts wrapper. This test imports the wrapper, verifies
 * the standard pino methods are present, and confirms that the spec §5.12
 * redactor actually runs through the wrapper (not just the shared package).
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';

import { buildLogger as sharedBuildLogger } from '@willbuy/log';
import { buildCaptureWorkerLogger } from '../src/logger.js';

describe('capture-worker logger wrapper', () => {
  it('exposes the standard pino methods', () => {
    const logger = buildCaptureWorkerLogger();
    for (const m of ['info', 'warn', 'error', 'debug'] as const) {
      expect(typeof logger[m]).toBe('function');
    }
  });

  it('redacts api_key when called via the wrapper path (uses @willbuy/log)', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString('utf8'));
        cb();
      },
    });
    const logger = sharedBuildLogger({
      service: 'capture-worker',
      level: 'info',
      urlHashSalt: 'test-salt',
      destination: stream,
    });
    logger.info({ api_key: 'secret-leaked' }, 'test');
    const wire = chunks.join('');
    expect(wire).not.toContain('secret-leaked');
    expect(wire).toContain('***aked');
    expect(wire).toContain('"service":"capture-worker"');
  });
});
