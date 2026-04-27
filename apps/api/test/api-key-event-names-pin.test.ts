/**
 * api-key-event-names-pin.test.ts — spec-pin for structured-log event names
 * emitted by apps/api/src/routes/api-keys.ts (spec §2 #21, §2 #22, §5.10).
 *
 * These event strings appear in pino JSON log lines as `event:` fields.
 * Security audit rules and SIEM integrations filter on them. Renaming would
 * silently break audit-trail queries with no test catching the mismatch.
 *
 *   'api_key.created'  — emitted after POST /api/api-keys succeeds; the
 *                        raw key is also logged masked (§2 #22) for
 *                        creation evidence
 *   'api_key.revoked'  — emitted after DELETE /api/api-keys/:id succeeds
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'api-keys.ts'), 'utf8');

describe('api-keys structured-log event names spec-pin (spec §2 #21, §5.10)', () => {
  it("'api_key.created' event name is present in api-keys.ts", () => {
    expect(src).toContain("'api_key.created'");
  });

  it("'api_key.revoked' event name is present in api-keys.ts", () => {
    expect(src).toContain("'api_key.revoked'");
  });
});
