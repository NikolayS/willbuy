/**
 * priorBadOutputMarkers.test.ts — spec-pins for PRIOR_BAD_OUTPUT_MARKER and
 * PRIOR_BAD_OUTPUT_END_MARKER in apps/visitor-worker/src/prompt.ts.
 *
 * These delimiter strings wrap the prior bad LLM output in the schema-repair
 * dynamic tail (spec §2 #14 / §5.15). The visitor-worker acceptance test in
 * runVisit.schemaRepair.test.ts verifies that the dynamic tail CONTAINS the
 * markers, but it imports the constants themselves — so if both the source
 * constant and the test import the same variable, a rename is transparent
 * to the test.
 *
 * Pinning the exact string values ensures:
 *   - The BEGIN marker is the literal "PRIOR_BAD_OUTPUT_BEGIN"
 *   - The END marker is the literal "PRIOR_BAD_OUTPUT_END"
 *   - Renaming either silently breaks any external system that parses the
 *     repair prompt expecting these delimiters
 */

import { describe, expect, it } from 'vitest';
import {
  PRIOR_BAD_OUTPUT_MARKER,
  PRIOR_BAD_OUTPUT_END_MARKER,
} from '../src/prompt.js';

describe('PRIOR_BAD_OUTPUT_MARKER spec-pin (visitor-worker/src/prompt.ts)', () => {
  it('is "PRIOR_BAD_OUTPUT_BEGIN"', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER).toBe('PRIOR_BAD_OUTPUT_BEGIN');
  });
});

describe('PRIOR_BAD_OUTPUT_END_MARKER spec-pin (visitor-worker/src/prompt.ts)', () => {
  it('is "PRIOR_BAD_OUTPUT_END"', () => {
    expect(PRIOR_BAD_OUTPUT_END_MARKER).toBe('PRIOR_BAD_OUTPUT_END');
  });
});

describe('marker pair consistency', () => {
  it('BEGIN marker does not equal END marker', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER).not.toBe(PRIOR_BAD_OUTPUT_END_MARKER);
  });

  it('both markers contain "PRIOR_BAD_OUTPUT" as a common prefix', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER).toContain('PRIOR_BAD_OUTPUT');
    expect(PRIOR_BAD_OUTPUT_END_MARKER).toContain('PRIOR_BAD_OUTPUT');
  });
});
