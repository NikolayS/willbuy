/**
 * eventNamesPin.test.ts — spec-pin for structured-log event names emitted by
 * apps/visitor-worker/src/poller.ts (spec §5.11, §5.12).
 *
 * These event strings appear as `event:` fields in pino JSON log lines.
 * Alerting rules filter on these values. Renaming any would silently break
 * on-call alerts with no test catching the mismatch.
 *
 * Covered events:
 *   'visit.no_snapshot'          — a11y_object_key is NULL; capture not linked
 *   'visit.storage_read_failed'  — object storage read error
 *   'visit.backstory_parse_failed' — backstory_payload JSON parse error
 *   'visit.backstory_invalid'    — backstory_payload fails Backstory schema
 *   'visitor_poll.error'         — unhandled error in the polling loop
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'poller.ts'), 'utf8');

describe('visitor-worker structured-log event names spec-pin (spec §5.11, §5.12)', () => {
  it("'visit.no_snapshot' event name is present", () => {
    expect(src).toContain("'visit.no_snapshot'");
  });

  it("'visit.storage_read_failed' event name is present", () => {
    expect(src).toContain("'visit.storage_read_failed'");
  });

  it("'visit.backstory_parse_failed' event name is present", () => {
    expect(src).toContain("'visit.backstory_parse_failed'");
  });

  it("'visit.backstory_invalid' event name is present", () => {
    expect(src).toContain("'visit.backstory_invalid'");
  });

  it("'visitor_poll.error' event name is present", () => {
    expect(src).toContain("'visitor_poll.error'");
  });
});
