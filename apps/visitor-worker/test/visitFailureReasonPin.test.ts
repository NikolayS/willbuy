/**
 * visitFailureReasonPin.test.ts — spec-pin for VisitFailureReason values
 * in apps/visitor-worker/src/visitor.ts (spec §2 #14, §2 #15).
 *
 * VisitFailureReason = 'schema' | 'transport' | 'cap'
 *
 *   'schema'    — the LLM output failed Zod validation after MAX_REPAIR_GENERATION
 *                 repair attempts; failure_reason written to visits row
 *   'transport' — the adapter returned status='error' (timeout / 5xx / reset);
 *                 failure_reason written to visits row
 *   'cap'       — reserved for future use: visit cost exceeded the per-visit
 *                 hard ceiling (spec §2 #15); not yet emitted in v0.1
 *
 * These strings land in `visits.terminal_reason` via the poller and are
 * used by alerting and the reconciliation job. If 'schema' is renamed to
 * 'zod_fail', the visitor-worker would stop emitting the expected string,
 * silently breaking any alert or report that filters on terminal_reason.
 *
 * 'schema' and 'transport' are tested behaviourally in lease-release.test.ts
 * and runVisit.*.test.ts on main. 'cap' is only in the type definition.
 * This pin covers all three strings explicitly.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(here, '..', 'src', 'visitor.ts'),
  'utf8',
);

describe('VisitFailureReason spec-pin (spec §2 #14 / §2 #15)', () => {
  it("includes 'schema' (schema-repair exhausted)", () => {
    expect(src).toContain("'schema'");
  });

  it("includes 'transport' (adapter error / timeout)", () => {
    expect(src).toContain("'transport'");
  });

  it("includes 'cap' (per-visit cost ceiling — reserved for v0.1+)", () => {
    expect(src).toContain("'cap'");
  });

  it('VisitFailureReason type has exactly 3 members', () => {
    const typeDecl = src.slice(
      src.indexOf('VisitFailureReason ='),
      src.indexOf(';', src.indexOf('VisitFailureReason =')),
    );
    const members = typeDecl.match(/'[^']+'/g) ?? [];
    expect(members).toHaveLength(3);
  });
});
