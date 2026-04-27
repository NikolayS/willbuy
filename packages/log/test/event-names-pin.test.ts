/**
 * event-names-pin.test.ts — spec-pin for structured-log event names emitted
 * by packages/log/src/index.ts (spec §5.12, issue #118 TDD #4).
 *
 * Two event names exist in the oversize-payload error path:
 *
 *   'log_payload_oversize'        — emitted to the logger's OWN destination
 *                                   when redact() throws LogPayloadOversizeError.
 *                                   This is the ALERT event. Already asserted
 *                                   in oversize.test.ts (l['event'] === 'log_payload_oversize').
 *
 *   'log_payload_oversize_caller' — returned by the pino formatters.log hook
 *                                   as the REPLACEMENT for the caller's original
 *                                   oversized log record. When the caller called
 *                                   logger.info({ body: bigString }), their log
 *                                   line receives this event instead of the
 *                                   original fields. Useful to explain why a
 *                                   caller sees an unexpected record shape.
 *
 * The second event is not asserted anywhere — only the first has a behavioral
 * test. Renaming 'log_payload_oversize_caller' would silently change the
 * replacement record shape in the caller's log stream.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

import { buildLogger } from '../src/index.js';
import { MAX_FIELD_BYTES } from '../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'index.ts'), 'utf8');

describe("log package oversize event names spec-pin (spec §5.12, issue #118)", () => {
  it("'log_payload_oversize' event name is present in index.ts", () => {
    expect(src).toContain("'log_payload_oversize'");
  });

  it("'log_payload_oversize_caller' event name is present in index.ts", () => {
    expect(src).toContain("'log_payload_oversize_caller'");
  });

  it("the caller's log line contains 'log_payload_oversize_caller' as its event value", () => {
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
      urlHashSalt: 'pin-test-salt',
      destination: stream,
    });
    const big = 'x'.repeat(MAX_FIELD_BYTES + 1);
    logger.info({ payload: big }, 'oversize test');
    const lines = chunks.join('').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    // The caller's line must use the replacement event name.
    const callerLine = lines.find((l) => l['event'] === 'log_payload_oversize_caller');
    expect(callerLine, 'caller log line should have event=log_payload_oversize_caller').toBeDefined();
  });
});
