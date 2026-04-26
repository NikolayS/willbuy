/**
 * redactor.test.ts — TDD acceptance for issue #118 spec §5.12.
 *
 * Covers the 10 forbidden-field rules end-to-end through buildLogger() so we
 * exercise the same redaction path the apps will use in production. Each
 * scenario asserts both (a) the field is removed/masked from the parsed JSON,
 * and (b) the raw secret never appears as a substring of the serialised line.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';

import { buildLogger, hashUrl, maskApiKey, maskEmail, redact } from '../src/index.js';

function captureLogs(salt = 's'.repeat(40)): {
  logs: () => Array<Record<string, unknown>>;
  raw: () => string;
  logger: ReturnType<typeof buildLogger>;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = buildLogger({
    service: 'test',
    level: 'info',
    urlHashSalt: salt,
    destination: stream,
  });
  return {
    logs: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    raw: () => chunks.join(''),
    logger,
  };
}

const salt = 's'.repeat(40);

describe('hashUrl()', () => {
  it('returns the first 16 hex chars of sha256(salt + url)', () => {
    const url = 'https://example.com/foo?bar=1';
    const expected = createHash('sha256')
      .update(salt + url)
      .digest('hex')
      .slice(0, 16);
    expect(hashUrl(salt, url)).toBe(expected);
  });

  it('is salt-sensitive', () => {
    const url = 'https://example.com/';
    expect(hashUrl('a'.repeat(32), url)).not.toBe(hashUrl('b'.repeat(32), url));
  });
});

// ---------------------------------------------------------------------------
// 1. URL fields are hashed; raw URL never reaches the log line.
// ---------------------------------------------------------------------------
describe('§5.12 #1 — URL fields hashed', () => {
  it('top-level url field becomes url_hash', () => {
    const { logger, logs, raw } = captureLogs();
    const url = 'https://example.com/secret/path?token=abc';
    logger.info({ url, study_id: 'st_1' }, 'capture started');
    const [rec] = logs();
    expect(rec!['url']).toBeUndefined();
    expect(rec!['url_hash']).toBe(hashUrl(salt, url));
    expect(raw()).not.toContain('example.com');
    expect(raw()).not.toContain('secret/path');
  });

  it('redirect_url, webhook_url etc. all hash by suffix', () => {
    const { logger, logs } = captureLogs();
    logger.info(
      { redirect_url: 'https://a.test/r', webhook_url: 'https://b.test/hook' },
      'urls',
    );
    const [rec] = logs();
    expect(rec!['redirect_url']).toBeUndefined();
    expect(rec!['redirect_url_hash']).toBe(hashUrl(salt, 'https://a.test/r'));
    expect(rec!['webhook_url']).toBeUndefined();
    expect(rec!['webhook_url_hash']).toBe(hashUrl(salt, 'https://b.test/hook'));
  });

  it('bare URL value under any field name is hashed', () => {
    const { logger, logs } = captureLogs();
    const fullUrl = 'https://example.com/path?q=1';
    logger.info({ endpoint: fullUrl }, 'bare url');
    const [rec] = logs();
    expect(rec!['endpoint']).toBeUndefined();
    expect(rec!['endpoint_hash']).toBe(hashUrl(salt, fullUrl));
  });
});

// ---------------------------------------------------------------------------
// 2. api_key field masked.
// ---------------------------------------------------------------------------
describe('§5.12 #2 — api_key masked', () => {
  it('reveals only last 4 chars', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info({ api_key: 'sk_live_secret123' }, 'auth');
    const [rec] = logs();
    expect(rec!['api_key']).toBe('***t123');
    expect(raw()).not.toContain('sk_live_secret');
  });
});

// ---------------------------------------------------------------------------
// 3. Token-like 32+ char hex/base64 strings masked even under foreign names.
// ---------------------------------------------------------------------------
describe('§5.12 #3 — token-like strings masked', () => {
  it('64-char hex bearer leaked under "auth" field is masked', () => {
    const { logger, logs, raw } = captureLogs();
    const tok = 'a'.repeat(64);
    logger.info({ auth: tok }, 'leaked');
    const [rec] = logs();
    expect(rec!['auth']).toBe(maskApiKey(tok));
    expect(raw()).not.toContain(tok);
  });

  it('44-char base64 JWT-segment under "credential" field is masked', () => {
    const { logger, logs, raw } = captureLogs();
    const tok = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxw';
    logger.info({ credential: tok }, 'leaked');
    const [rec] = logs();
    // contains a `.` so not pure b64 — but each segment is still long enough
    // to look like a token; we accept either masked or removed but the raw
    // value must be gone.
    expect(raw()).not.toContain(tok);
    // and the field, if present, must not equal the original
    expect(rec!['credential']).not.toBe(tok);
  });

  it('22-char nanoid share_token is removed by name (shorter than 32)', () => {
    const { logger, logs, raw } = captureLogs();
    const nano = 'abc123def456ghi789jklm';
    logger.info({ share_token: nano }, 'leaked');
    const [rec] = logs();
    expect(rec!['share_token']).toBeUndefined();
    expect(raw()).not.toContain(nano);
  });
});

// ---------------------------------------------------------------------------
// 4. provider_payload removed entirely.
// ---------------------------------------------------------------------------
describe('§5.12 #4 — provider_payload removed', () => {
  it('strips the field even when nested', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info(
      { provider_payload: { messages: [{ role: 'user', content: 'hi' }] } },
      'upstream',
    );
    const [rec] = logs();
    expect(rec!['provider_payload']).toBeUndefined();
    expect(raw()).not.toContain('messages');
    expect(raw()).not.toContain('hi');
  });
});

// ---------------------------------------------------------------------------
// 5. a11y_tree removed.
// ---------------------------------------------------------------------------
describe('§5.12 #5 — a11y_tree removed', () => {
  it('strips both deep tree and inline string', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info(
      { a11y_tree: { role: 'document', children: [{ role: 'main' }] } },
      'snapshot',
    );
    const [rec] = logs();
    expect(rec!['a11y_tree']).toBeUndefined();
    expect(raw()).not.toContain('document');
  });
});

// ---------------------------------------------------------------------------
// 6. llm_output removed.
// ---------------------------------------------------------------------------
describe('§5.12 #6 — llm_output removed', () => {
  it('strips the field', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info({ llm_output: 'I am the model speaking very candidly' }, 'evt');
    const [rec] = logs();
    expect(rec!['llm_output']).toBeUndefined();
    expect(raw()).not.toContain('I am the model');
  });
});

// ---------------------------------------------------------------------------
// 7. email masked (t***@d***.tld).
// ---------------------------------------------------------------------------
describe('§5.12 #7 — email masked', () => {
  it('masks email field to single-letter local + domain shape', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info({ email: 'nik@postgres.ai' }, 'evt');
    const [rec] = logs();
    expect(rec!['email']).toBe('n***@p***.ai');
    expect(raw()).not.toContain('nik@postgres.ai');
  });

  it('masks bare email values under foreign field names', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info({ contact: 'a@b.com' }, 'evt');
    const [rec] = logs();
    expect(rec!['contact']).toBe(maskEmail('a@b.com'));
    expect(raw()).not.toContain('a@b.com');
  });
});

// ---------------------------------------------------------------------------
// 8. Captured-page bytes — page_bytes field removed; HTML-shaped or oversized
//    string fields are replaced with a size marker.
// ---------------------------------------------------------------------------
describe('§5.12 #8 — captured page bytes', () => {
  it('strips a literal page_bytes field', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info({ page_bytes: '<html><body>secret</body></html>' }, 'capture');
    const [rec] = logs();
    expect(rec!['page_bytes']).toBeUndefined();
    expect(raw()).not.toContain('secret');
  });

  it('replaces HTML-shaped string under any field name with a size marker', () => {
    const { logger, logs, raw } = captureLogs();
    const html =
      '<html><body><div class="card">' +
      'leaked-secret-content-that-must-not-reach-logs'.repeat(2) +
      '</div></body></html>';
    logger.info({ body: html }, 'capture');
    const [rec] = logs();
    expect(rec!['body']).toMatch(/^\[redacted:\d+b\]$/);
    expect(raw()).not.toContain('leaked-secret-content');
  });

  // Issue #118 TDD #4 supersedes the older silent-size-marker behaviour for
  // very large strings: a single field exceeding the 8 KiB cap now throws
  // LogPayloadOversizeError, which the formatter catches and emits as a
  // structured `log_payload_oversize` alert event. See test/oversize.test.ts
  // for the full alert-path contract; this test just confirms the original
  // 20 KiB blob never reaches the wire.
  it('20 KiB string in a field is alerted on (TDD #4) — never reaches wire', () => {
    const { logger, raw } = captureLogs();
    const big = 'x'.repeat(20 * 1024);
    logger.info({ blob: big }, 'capture');
    expect(raw()).not.toContain(big);
    expect(raw()).toContain('log_payload_oversize');
  });
});

// ---------------------------------------------------------------------------
// 9. Recursive: all redactions apply at depth 5+.
// ---------------------------------------------------------------------------
describe('§5.12 #9 — recursive redaction at depth 5+', () => {
  it('strips/masks across nested objects', () => {
    const { logger, logs, raw } = captureLogs();
    logger.info(
      {
        d1: {
          d2: {
            d3: {
              d4: {
                d5: {
                  email: 'deep@x.com',
                  api_key: 'sk_test_abcdwxyz',
                  url: 'https://deep.example/path',
                  share_token: 'abc123def456ghi789jklm',
                  llm_output: 'deep model output',
                  provider_payload: { msg: 'deep payload' },
                  a11y_tree: { role: 'doc' },
                  page_bytes: '<html>deep page</html>',
                  account_id: 'acc_1',
                },
              },
            },
          },
        },
      },
      'deep',
    );
    const [rec] = logs();
    const d5 = (
      ((((rec!['d1'] as Record<string, unknown>)['d2'] as Record<string, unknown>)['d3'] as Record<
        string,
        unknown
      >)['d4'] as Record<string, unknown>)['d5'] as Record<string, unknown>
    );
    expect(d5['email']).toBe(maskEmail('deep@x.com'));
    expect(d5['api_key']).toBe('***wxyz');
    expect(d5['url']).toBeUndefined();
    expect(d5['url_hash']).toBe(hashUrl(salt, 'https://deep.example/path'));
    expect(d5['share_token']).toBeUndefined();
    expect(d5['llm_output']).toBeUndefined();
    expect(d5['provider_payload']).toBeUndefined();
    expect(d5['a11y_tree']).toBeUndefined();
    expect(d5['page_bytes']).toBeUndefined();
    expect(d5['account_id']).toBe('acc_1');

    const r = raw();
    expect(r).not.toContain('deep@x.com');
    expect(r).not.toContain('sk_test_abcdwxyz');
    expect(r).not.toContain('deep.example');
    expect(r).not.toContain('abc123def456ghi789jklm');
    expect(r).not.toContain('deep model output');
    expect(r).not.toContain('deep payload');
    expect(r).not.toContain('deep page');
  });
});

// ---------------------------------------------------------------------------
// 10. DAG / cycle handling carried over from PR #92.
// ---------------------------------------------------------------------------
describe('§5.12 #10 — DAG/cycle handling preserved', () => {
  it('shared leaf object is NOT falsely flagged as [Circular]', () => {
    const { logger, logs } = captureLogs();
    const shared = { x: 'safe' };
    logger.info({ a: shared, b: shared }, 'dag');
    const [rec] = logs();
    const a = rec!['a'] as Record<string, unknown>;
    const b = rec!['b'] as Record<string, unknown>;
    expect(a['x']).toBe('safe');
    expect(b['x']).toBe('safe');
  });

  it('real self-cycle is reported as [Circular]', () => {
    const { logger, logs } = captureLogs();
    const a: Record<string, unknown> = { id: 'node' };
    a['self'] = a;
    logger.info({ node: a }, 'cycle');
    const [rec] = logs();
    const node = rec!['node'] as Record<string, unknown>;
    expect(node['self']).toBe('[Circular]');
    expect(node['id']).toBe('node');
  });
});

// ---------------------------------------------------------------------------
// Direct redact() unit tests — fast feedback for CI without going through
// pino's formatter (the same code path, but dispenses with stream plumbing).
// ---------------------------------------------------------------------------
describe('redact() direct calls', () => {
  it('preserves allowlisted spec §5.12 fields verbatim', () => {
    const r = redact(
      {
        account_id: 'acc_1',
        study_id: 'st_1',
        visit_id: 'v_1',
        provider_attempt_id: 'pa_1',
        transport_attempt_id: 'ta_1',
        event: 'capture.started',
        duration_ms: 1234,
        error_class: 'TimeoutError',
      },
      salt,
    ) as Record<string, unknown>;
    expect(r['account_id']).toBe('acc_1');
    expect(r['study_id']).toBe('st_1');
    expect(r['visit_id']).toBe('v_1');
    expect(r['provider_attempt_id']).toBe('pa_1');
    expect(r['transport_attempt_id']).toBe('ta_1');
    expect(r['event']).toBe('capture.started');
    expect(r['duration_ms']).toBe(1234);
    expect(r['error_class']).toBe('TimeoutError');
  });

  it('descriptions containing a URL substring are NOT hashed (only bare URLs)', () => {
    const r = redact(
      { description: 'see https://example.com for details' },
      salt,
    ) as Record<string, unknown>;
    expect(r['description']).toBe('see https://example.com for details');
  });

  it('arrays of bare URLs are hashed leaf-wise', () => {
    const r = redact(
      { urls: ['https://a.test/', 'https://b.test/'] },
      salt,
    ) as unknown as { urls: string[] };
    expect(r.urls).toEqual([hashUrl(salt, 'https://a.test/'), hashUrl(salt, 'https://b.test/')]);
  });
});

// ---------------------------------------------------------------------------
// 11. Strict allowlist mode — unknown fields are dropped when strict=true.
// ---------------------------------------------------------------------------
describe('strict allowlist mode', () => {
  it('drops a field not in the allowlist when strict=true', () => {
    const r = redact(
      { event: 'capture.started', study_id: 'st_1', secret_data: 'should-be-gone' },
      salt,
      undefined,
      true,
    ) as Record<string, unknown>;
    expect(r['secret_data']).toBeUndefined();
    expect(r['event']).toBe('capture.started');
    expect(r['study_id']).toBe('st_1');
  });

  it('passes through a non-allowlisted field when strict=false (default)', () => {
    const r = redact(
      { event: 'capture.started', secret_data: 'passes-through' },
      salt,
    ) as Record<string, unknown>;
    expect(r['secret_data']).toBe('passes-through');
  });

  it('passes through duration_* fields when strict=true', () => {
    const r = redact(
      { event: 'capture.done', duration_ms: 1234, duration_capture_ms: 999 },
      salt,
      undefined,
      true,
    ) as Record<string, unknown>;
    expect(r['duration_ms']).toBe(1234);
    expect(r['duration_capture_ms']).toBe(999);
  });

  it('drops error_detail regardless of strict mode (REMOVE_FIELDS)', () => {
    const r = redact(
      { event: 'broker.rejected', visit_id: 'v_1', error_class: 'ValidationError', error_detail: 'some debug string' },
      salt,
    ) as Record<string, unknown>;
    expect(r['error_detail']).toBeUndefined();
    expect(r['event']).toBe('broker.rejected');
    expect(r['error_class']).toBe('ValidationError');
  });

  it('strips secret_data via buildLogger strict:true but not strict:false', () => {
    function captureWithStrict(strict: boolean): Record<string, unknown> {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString('utf8'));
          cb();
        },
      });
      const strictLogger = buildLogger({
        service: 'test-strict',
        level: 'info',
        urlHashSalt: salt,
        destination: stream,
        strict,
      });
      strictLogger.info({ event: 'test', secret_data: 'boom', study_id: 'st_99' }, 'msg');
      const parsed = chunks.join('').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      return parsed[0] ?? {};
    }

    const strictRec = captureWithStrict(true);
    expect(strictRec['secret_data']).toBeUndefined();
    expect(strictRec['study_id']).toBe('st_99');

    const permissiveRec = captureWithStrict(false);
    expect(permissiveRec['secret_data']).toBe('boom');
  });
});
