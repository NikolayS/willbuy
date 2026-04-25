/**
 * redact.test.ts — TDD acceptance tests for PR #14 review findings (issue #16).
 *
 * Fix 1: maskApiKey dead branch — no new test needed (branch deleted, existing
 *        tests still cover the happy-path masking behaviour).
 * Fix 2: WeakSet DAG false-positive and real-cycle detection.
 * Fix 3: URL hashing extended to any field whose value is a full https?:// URL.
 */

import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';

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

const salt = 's'.repeat(40);

// ---------------------------------------------------------------------------
// Fix 2 — DAG: shared leaf object must NOT be reported as [Circular]
// ---------------------------------------------------------------------------
describe('Fix 2 — DAG shared object is not falsely flagged as [Circular]', () => {
  it('{a: shared, b: shared} — both a.x and b.x should equal the original value', () => {
    const { logger, logs } = captureLogs(salt);
    const shared = { x: 'safe' };
    logger.info({ a: shared, b: shared }, 'dag test');
    const [rec] = logs();
    const a = rec!['a'] as Record<string, unknown>;
    const b = rec!['b'] as Record<string, unknown>;
    expect(a['x']).toBe('safe');
    expect(b['x']).toBe('safe');
    // Neither branch should be [Circular]
    expect(a['x']).not.toBe('[Circular]');
    expect(b['x']).not.toBe('[Circular]');
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — Real cycle: a self-referencing object MUST be reported as [Circular]
// ---------------------------------------------------------------------------
describe('Fix 2 — real circular reference is detected and reported', () => {
  it('a.self = a → a.self should be "[Circular]"', () => {
    const { logger, logs } = captureLogs(salt);
    const a: Record<string, unknown> = { id: 'node' };
    a['self'] = a; // real cycle
    logger.info({ node: a }, 'cycle test');
    const [rec] = logs();
    const node = rec!['node'] as Record<string, unknown>;
    expect(node['self']).toBe('[Circular]');
    expect(node['id']).toBe('node');
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — URL hashing extended to any *_url fields and full-URL values
// ---------------------------------------------------------------------------
describe('Fix 3 — URL hashing on non-"url" field names', () => {
  it('hashes redirect_url, webhook_url, target_url fields', () => {
    const { logger, logs } = captureLogs(salt);
    const redirectUrl = 'https://example.com/redirect';
    const webhookUrl = 'https://hooks.example.com/webhook/abc';
    const targetUrl = 'https://target.example.net/page';
    logger.info(
      {
        redirect_url: redirectUrl,
        webhook_url: webhookUrl,
        target_url: targetUrl,
        safe_field: 'unchanged',
      },
      'url fields test',
    );
    const [rec] = logs();
    // Original field names should be gone or replaced
    expect(rec!['redirect_url']).toBeUndefined();
    expect(rec!['redirect_url_hash']).toBe(hashUrl(salt, redirectUrl));
    expect(rec!['webhook_url']).toBeUndefined();
    expect(rec!['webhook_url_hash']).toBe(hashUrl(salt, webhookUrl));
    expect(rec!['target_url']).toBeUndefined();
    expect(rec!['target_url_hash']).toBe(hashUrl(salt, targetUrl));
    expect(rec!['safe_field']).toBe('unchanged');
    // Raw hostnames must not appear
    const ser = JSON.stringify(rec);
    expect(ser).not.toContain('example.com/redirect');
    expect(ser).not.toContain('hooks.example.com');
    expect(ser).not.toContain('target.example.net');
  });

  it('does NOT hash a description field that merely contains a URL as a substring', () => {
    const { logger, logs } = captureLogs(salt);
    const desc = 'see https://example.com for details';
    logger.info({ description: desc }, 'substring url test');
    const [rec] = logs();
    // The full string should pass through unchanged because it is not a bare URL
    expect(rec!['description']).toBe(desc);
  });

  it('hashes a string field whose entire value is a URL regardless of field name', () => {
    const { logger, logs } = captureLogs(salt);
    const fullUrl = 'https://example.com/path?q=1';
    logger.info({ endpoint: fullUrl }, 'bare-url field test');
    const [rec] = logs();
    // endpoint value is a bare URL → should be hashed
    expect(rec!['endpoint']).toBeUndefined();
    expect(rec!['endpoint_hash']).toBe(hashUrl(salt, fullUrl));
  });
});
