/**
 * studiesInitialStatusPin.test.ts — spec-pin for the initial status SQL strings
 * written by POST /api/studies in apps/api/src/routes/studies.ts (spec §5.11).
 *
 * When a study is created the API writes two initial status values:
 *   studies.status = 'capturing'  — polls the capture-worker
 *   visits.status  = 'started'    — polls the capture-worker per-visit
 *
 * The capture-worker's poll query filters on BOTH of these (s.status='capturing'
 * and visit rows with status NOT IN ('ok','failed','indeterminate')).  If either
 * is renamed here but not in the capture-worker's SELECT, the worker finds zero
 * rows and the study silently stalls.
 *
 * Both are SQL template-literal strings, not TypeScript types.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'studies.ts'), 'utf8');

describe("POST /api/studies initial status SQL strings (spec §5.11)", () => {
  it("inserts study with initial status = 'capturing'", () => {
    expect(src).toContain("'capturing'");
  });

  it("inserts visits with initial status = 'started'", () => {
    expect(src).toContain("'started'");
  });

  it("'capturing' appears in a VALUES clause of the studies INSERT", () => {
    // The INSERT uses 'capturing' as the third positional value in VALUES.
    expect(src).toContain("VALUES ($1, $2, 'capturing'");
  });

  it("'started' appears in a VALUES clause of the visits INSERT", () => {
    // The INSERT uses 'started' as the fourth positional value in VALUES.
    expect(src).toContain("VALUES ($1, $2, $3, 'started')");
  });
});
