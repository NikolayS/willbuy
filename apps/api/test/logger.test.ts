import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';

import { buildLogger, hashUrl } from '../src/logger.js';

function captureLogs(salt: string): {
  logs: () => Array<Record<string, unknown>>;
  logger: ReturnType<typeof buildLogger>;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = buildLogger({ level: 'info', urlHashSalt: salt }, stream);
  return {
    logs: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    logger,
  };
}

describe('hashUrl()', () => {
  it('returns the first 16 hex chars of sha256(salt + url)', () => {
    const salt = 'a'.repeat(32);
    const url = 'https://example.com/foo?bar=1';
    const expected = createHash('sha256')
      .update(salt + url)
      .digest('hex')
      .slice(0, 16);
    expect(hashUrl(salt, url)).toBe(expected);
  });

  it('is salt-sensitive (different salts → different hashes)', () => {
    const url = 'https://example.com/';
    expect(hashUrl('a'.repeat(32), url)).not.toBe(hashUrl('b'.repeat(32), url));
  });
});

describe('logger redaction (spec §5.12)', () => {
  const salt = 's'.repeat(40);

  it('replaces a top-level url field with url_hash; raw URL never appears', () => {
    const { logger, logs } = captureLogs(salt);
    const url = 'https://example.com/secret/path?token=abc';
    logger.info({ url, study_id: 'st_1' }, 'capture started');
    const [rec] = logs();
    expect(rec).toBeDefined();
    expect(rec!['url']).toBeUndefined();
    expect(rec!['url_hash']).toBe(hashUrl(salt, url));
    const ser = JSON.stringify(rec);
    expect(ser).not.toContain('example.com');
    expect(ser).not.toContain('secret/path');
  });

  it('replaces a nested url field with url_hash', () => {
    const { logger, logs } = captureLogs(salt);
    const url = 'https://nested.example.org/page';
    logger.info({ capture: { url, host_count: 3 } }, 'nested');
    const [rec] = logs();
    const cap = rec!['capture'] as Record<string, unknown>;
    expect(cap['url']).toBeUndefined();
    expect(cap['url_hash']).toBe(hashUrl(salt, url));
    expect(JSON.stringify(rec)).not.toContain('nested.example.org');
  });

  it('masks api_key to last 4 chars', () => {
    const { logger, logs } = captureLogs(salt);
    logger.info({ api_key: 'sk_live_secret123' }, 'auth');
    const [rec] = logs();
    expect(rec!['api_key']).toBe('***t123');
    expect(JSON.stringify(rec)).not.toContain('sk_live_secret');
  });

  it('removes email field entirely', () => {
    const { logger, logs } = captureLogs(salt);
    logger.info({ email: 'a@b.com', account_id: 'acc_1' }, 'evt');
    const [rec] = logs();
    expect(rec!['email']).toBeUndefined();
    expect(rec!['account_id']).toBe('acc_1');
    expect(JSON.stringify(rec)).not.toContain('a@b.com');
  });

  it('removes share_token, backstory, a11y_tree, llm_output, provider_payload, password fields', () => {
    const { logger, logs } = captureLogs(salt);
    logger.info(
      {
        share_token: 'tok_xxxxxxxxxxxxxxxxxxxx22',
        backstory: 'the quick brown fox is a saas founder',
        a11y_tree: { role: 'document', children: [] },
        llm_output: 'I am the model speaking',
        provider_payload: { messages: [{ role: 'user', content: 'hi' }] },
        password: 'hunter2',
        visit_id: 'v_1',
      },
      'evt',
    );
    const [rec] = logs();
    expect(rec!['share_token']).toBeUndefined();
    expect(rec!['backstory']).toBeUndefined();
    expect(rec!['a11y_tree']).toBeUndefined();
    expect(rec!['llm_output']).toBeUndefined();
    expect(rec!['provider_payload']).toBeUndefined();
    expect(rec!['password']).toBeUndefined();
    expect(rec!['visit_id']).toBe('v_1');
    const ser = JSON.stringify(rec);
    expect(ser).not.toContain('tok_xxxxxxxxxxxxxxxxxxxx22');
    expect(ser).not.toContain('quick brown fox');
    expect(ser).not.toContain('I am the model');
    expect(ser).not.toContain('hunter2');
  });

  it('redacts deeply nested forbidden fields', () => {
    const { logger, logs } = captureLogs(salt);
    logger.info(
      { ctx: { inner: { email: 'deep@x.com', api_key: 'sk_test_abcdwxyz' } } },
      'deep',
    );
    const [rec] = logs();
    const inner = (rec!['ctx'] as Record<string, unknown>)['inner'] as Record<string, unknown>;
    expect(inner['email']).toBeUndefined();
    expect(inner['api_key']).toBe('***wxyz');
    expect(JSON.stringify(rec)).not.toContain('deep@x.com');
  });
});
