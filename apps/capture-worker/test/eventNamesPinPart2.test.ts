/**
 * eventNamesPinPart2.test.ts — spec-pin for 3 structured-log event names
 * omitted from PR #451 (test/capture-worker-event-names-pin).
 *
 * PR #451 covered: broker.rejected, broker.send_failed, capture.no_url,
 * startup.runtime, startup.missing_env, shutdown.sigterm, shutdown.drained.
 *
 * This file pins the remaining 3:
 *   'startup.invalid_runtime'  — emitted when WILLBUY_CAPTURE_RUNTIME env
 *                                var holds an unrecognised value; fatal
 *                                startup failure with the bad value logged
 *   'startup.polling_loop'     — emitted just before the main polling loop
 *                                starts; absence from logs signals a startup
 *                                hang between env validation and polling
 *   'poll.error'               — catch-all for unhandled errors in pollOnce;
 *                                triggers a brief backoff before the next tick
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pollerSrc = readFileSync(resolve(here, '..', 'src', 'poller.ts'), 'utf8');
const indexSrc = readFileSync(resolve(here, '..', 'src', 'index.ts'), 'utf8');

describe("capture-worker remaining structured-log event names (spec §5.13)", () => {
  it("'startup.invalid_runtime' event name is present in index.ts", () => {
    expect(indexSrc).toContain("'startup.invalid_runtime'");
  });

  it("'startup.polling_loop' event name is present in index.ts", () => {
    expect(indexSrc).toContain("'startup.polling_loop'");
  });

  it("'poll.error' event name is present in poller.ts", () => {
    expect(pollerSrc).toContain("'poll.error'");
  });
});
