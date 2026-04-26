/**
 * order.test.ts — TDD acceptance for issue #118 TDD #6.
 *
 * Asserts that the §5.12 redactor runs BEFORE the destination write in the
 * pino pipeline. Structurally this holds because redaction is in
 * `formatters.log` (called pre-serialise), but the spec calls for an explicit
 * unit test on the ordering — this is that test.
 *
 * Strategy: build a logger with a mock destination Writable, log a value
 * containing a sentinel api-key, then read back the destination's bytes and
 * assert the unredacted secret never reaches the wire.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';

import { buildLogger } from '../src/index.js';

function captureStream(): { stream: Writable; bytes: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  return { stream, bytes: () => Buffer.concat(chunks).toString('utf8') };
}

describe('TDD #6 — redactor runs BEFORE destination write', () => {
  it('destination never sees the unredacted api_key value', () => {
    const { stream, bytes } = captureStream();
    const logger = buildLogger({
      service: 'test',
      level: 'info',
      urlHashSalt: 'salt-for-ordering-test',
      destination: stream,
    });
    logger.info({ api_key: 'sk_secret_leaked' }, 'auth attempt');
    const wire = bytes();
    expect(wire.length).toBeGreaterThan(0);
    expect(wire).not.toContain('sk_secret_leaked');
    // And the masked form must be present, confirming redaction did run.
    expect(wire).toContain('***aked');
  });

  it('destination never sees a leaked share_token', () => {
    const { stream, bytes } = captureStream();
    const logger = buildLogger({
      service: 'test',
      level: 'info',
      urlHashSalt: 'salt-for-ordering-test',
      destination: stream,
    });
    const tok = 'abc123def456ghi789jklm';
    logger.info({ share_token: tok }, 'evt');
    expect(bytes()).not.toContain(tok);
  });

  it('destination never sees a raw URL — only the *_hash form', () => {
    const { stream, bytes } = captureStream();
    const logger = buildLogger({
      service: 'test',
      level: 'info',
      urlHashSalt: 'salt-for-ordering-test',
      destination: stream,
    });
    logger.info({ url: 'https://example.com/private/path' }, 'evt');
    const wire = bytes();
    expect(wire).not.toContain('example.com');
    expect(wire).not.toContain('private/path');
    expect(wire).toContain('url_hash');
  });
});
