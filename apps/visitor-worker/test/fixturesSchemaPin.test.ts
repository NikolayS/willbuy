/**
 * fixturesSchemaPin.test.ts — validate test fixtures against the Zod schemas
 * they are claimed to satisfy (spec §2 #5, §2 #15).
 *
 * The fixtures in test/helpers/fixtures.ts carry TypeScript types but are
 * never Zod-validated at runtime. If a schema changes (new required field,
 * tighter bounds) the TypeScript compiler will catch it — but only if the
 * type is re-checked. This file does runtime parse to catch schema drifts
 * that the compiler might miss (e.g. changes to enum value sets).
 */

import { describe, it, expect } from 'vitest';
import { Backstory, VisitorOutput } from '@willbuy/shared';
import {
  SAMPLE_BACKSTORY,
  VALID_VISITOR_OUTPUT,
} from './helpers/fixtures.js';

describe('SAMPLE_BACKSTORY — runtime Backstory schema parse (spec §2 #5)', () => {
  it('parses without error against the Backstory Zod schema', () => {
    const result = Backstory.safeParse(SAMPLE_BACKSTORY);
    expect(result.success).toBe(true);
  });

  it('has the correct name "Maya"', () => {
    expect(SAMPLE_BACKSTORY.name).toBe('Maya');
  });
});

describe('VALID_VISITOR_OUTPUT — runtime VisitorOutput schema parse (spec §2 #15)', () => {
  it('parses without error against the VisitorOutput Zod schema', () => {
    const result = VisitorOutput.safeParse(VALID_VISITOR_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('has next_action="contact_sales" (drives scoring test expectations)', () => {
    expect(VALID_VISITOR_OUTPUT.next_action).toBe('contact_sales');
  });

  it('has will_to_buy in [0, 10]', () => {
    expect(VALID_VISITOR_OUTPUT.will_to_buy).toBeGreaterThanOrEqual(0);
    expect(VALID_VISITOR_OUTPUT.will_to_buy).toBeLessThanOrEqual(10);
  });
});
