/**
 * oversize.test.ts — TDD acceptance for issue #118 TDD #4.
 *
 * Spec §5.12: oversize string fields (>8 KiB single field) are a smell of an
 * accidental payload-leak. Rather than silently size-marking, the redactor
 * MUST throw a typed `LogPayloadOversizeError`. The pino formatter wraps the
 * call in try/catch, swallows the throw (so the original log call doesn't
 * blow up the caller), and emits a structured `log_payload_oversize` alert
 * event to the destination instead.
 *
 * This pair of tests asserts:
 *   1. The redactor itself throws LogPayloadOversizeError on a >8 KiB field.
 *   2. The pino logger built by buildLogger() catches that error and emits
 *      an alert log line carrying { event, field, size }.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';

import { buildLogger } from '../src/index.js';
import { LogPayloadOversizeError, MAX_FIELD_BYTES } from '../src/errors.js';
import { redact } from '../src/redactor.js';

describe('TDD #4 — oversize string fields throw LogPayloadOversizeError', () => {
  it('redact() throws on a single string field > MAX_FIELD_BYTES', () => {
    const big = 'x'.repeat(MAX_FIELD_BYTES + 1);
    expect(() => redact({ body: big }, 'salt')).toThrow(LogPayloadOversizeError);
  });

  it('the thrown error carries field and size context', () => {
    const big = 'y'.repeat(MAX_FIELD_BYTES + 100);
    let caught: unknown = null;
    try {
      redact({ payload: big }, 'salt');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LogPayloadOversizeError);
    const err = caught as LogPayloadOversizeError;
    expect(err.field).toBe('payload');
    expect(err.size).toBeGreaterThan(MAX_FIELD_BYTES);
  });

  it('strings at exactly MAX_FIELD_BYTES do NOT throw', () => {
    const exactly = 'z'.repeat(MAX_FIELD_BYTES);
    // 16 KiB threshold also kicks in; we just need: no throw.
    expect(() => redact({ body: exactly }, 'salt')).not.toThrow();
  });

  it('throw is by byte length, not by char count (multi-byte chars)', () => {
    // A 3-byte UTF-8 char repeated such that the byte length exceeds the
    // threshold even though char count is below it.
    const ch = 'あ'; // 3 bytes in UTF-8
    const count = Math.floor(MAX_FIELD_BYTES / 3) + 10;
    const big = ch.repeat(count);
    expect(() => redact({ note: big }, 'salt')).toThrow(LogPayloadOversizeError);
  });
});

describe('TDD #4 — pino formatter catches and emits alert event', () => {
  function captureLogs(): {
    stream: Writable;
    logs: () => Array<Record<string, unknown>>;
    raw: () => string;
  } {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString('utf8'));
        cb();
      },
    });
    return {
      stream,
      logs: () =>
        chunks
          .join('')
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => JSON.parse(l) as Record<string, unknown>),
      raw: () => chunks.join(''),
    };
  }

  it('does not throw to the caller on oversize', () => {
    const { stream } = captureLogs();
    const logger = buildLogger({
      service: 'test',
      level: 'info',
      urlHashSalt: 'salt',
      destination: stream,
    });
    const big = 'a'.repeat(MAX_FIELD_BYTES + 50);
    expect(() => logger.info({ body: big }, 'oversize attempt')).not.toThrow();
  });

  it('emits a structured alert event with field + size', () => {
    const { stream, logs, raw } = captureLogs();
    const logger = buildLogger({
      service: 'test',
      level: 'info',
      urlHashSalt: 'salt',
      destination: stream,
    });
    const big = 'a'.repeat(MAX_FIELD_BYTES + 50);
    logger.info({ body: big, account_id: 'acc_1' }, 'oversize attempt');
    const lines = logs();
    const alert = lines.find((l) => l['event'] === 'log_payload_oversize');
    expect(alert).toBeDefined();
    expect(alert!['level']).toBe(50); // pino numeric level for "error"
    expect(alert!['field']).toBe('body');
    expect(typeof alert!['size']).toBe('number');
    expect(alert!['size']).toBeGreaterThan(MAX_FIELD_BYTES);
    // The huge payload itself must NEVER reach the wire.
    expect(raw()).not.toContain(big);
  });
});

describe('MAX_FIELD_BYTES spec-pin (spec §5.12)', () => {
  it('MAX_FIELD_BYTES is 8192 (8 KiB)', () => {
    expect(MAX_FIELD_BYTES).toBe(8192);
  });
});
