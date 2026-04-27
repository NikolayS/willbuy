/**
 * promptBuilders.test.ts — unit tests for buildDynamicTail() and
 * buildRepairTail() prompt builders (spec §2 #14, §2 #15).
 *
 * buildStaticPrefix() returns a module-level constant (tested implicitly);
 * the dynamic and repair builders assemble per-visit prompt sections and
 * must not accidentally cross role boundaries or drop required markers.
 *
 * Key contracts (spec §2 #14):
 *  - Repair tail MUST include PRIOR_BAD_OUTPUT_MARKER and
 *    PRIOR_BAD_OUTPUT_END_MARKER wrapping the prior raw output.
 *  - The prior bad output must appear as user content, not as a
 *    continuation of the assistant turn.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDynamicTail,
  buildRepairTail,
  PRIOR_BAD_OUTPUT_MARKER,
  PRIOR_BAD_OUTPUT_END_MARKER,
} from '../src/prompt.js';
import { SAMPLE_BACKSTORY, SAMPLE_PAGE_SNAPSHOT } from './helpers/fixtures.js';

describe('buildDynamicTail() — spec §2 #15', () => {
  it('includes the section label BACKSTORY:', () => {
    const tail = buildDynamicTail(SAMPLE_BACKSTORY, SAMPLE_PAGE_SNAPSHOT);
    expect(tail).toContain('BACKSTORY:');
  });

  it('includes the section label PAGE_SNAPSHOT:', () => {
    const tail = buildDynamicTail(SAMPLE_BACKSTORY, SAMPLE_PAGE_SNAPSHOT);
    expect(tail).toContain('PAGE_SNAPSHOT:');
  });

  it('includes all backstory field values', () => {
    const tail = buildDynamicTail(SAMPLE_BACKSTORY, SAMPLE_PAGE_SNAPSHOT);
    expect(tail).toContain(SAMPLE_BACKSTORY.name);
    expect(tail).toContain(SAMPLE_BACKSTORY.role_archetype);
    expect(tail).toContain(SAMPLE_BACKSTORY.stage);
    expect(tail).toContain(String(SAMPLE_BACKSTORY.team_size));
    expect(tail).toContain(SAMPLE_BACKSTORY.managed_postgres);
    expect(tail).toContain(SAMPLE_BACKSTORY.current_pain);
    expect(tail).toContain(SAMPLE_BACKSTORY.entry_point);
  });

  it('includes the page snapshot content', () => {
    const tail = buildDynamicTail(SAMPLE_BACKSTORY, SAMPLE_PAGE_SNAPSHOT);
    expect(tail).toContain(SAMPLE_PAGE_SNAPSHOT);
  });

  it('BACKSTORY: appears before PAGE_SNAPSHOT:', () => {
    const tail = buildDynamicTail(SAMPLE_BACKSTORY, SAMPLE_PAGE_SNAPSHOT);
    expect(tail.indexOf('BACKSTORY:')).toBeLessThan(tail.indexOf('PAGE_SNAPSHOT:'));
  });
});

describe('buildRepairTail() — spec §2 #14 (prior bad output markers)', () => {
  const PRIOR_RAW = '{ invalid json }';
  const VALIDATION_ERROR = 'missing field: next_action';

  it('wraps prior bad output between PRIOR_BAD_OUTPUT_MARKER and END_MARKER', () => {
    const tail = buildRepairTail(
      SAMPLE_BACKSTORY,
      SAMPLE_PAGE_SNAPSHOT,
      PRIOR_RAW,
      VALIDATION_ERROR,
    );
    expect(tail).toContain(PRIOR_BAD_OUTPUT_MARKER);
    expect(tail).toContain(PRIOR_BAD_OUTPUT_END_MARKER);
  });

  it('prior raw output appears between the two markers', () => {
    const tail = buildRepairTail(
      SAMPLE_BACKSTORY,
      SAMPLE_PAGE_SNAPSHOT,
      PRIOR_RAW,
      VALIDATION_ERROR,
    );
    const markerStart = tail.indexOf(PRIOR_BAD_OUTPUT_MARKER);
    const markerEnd = tail.indexOf(PRIOR_BAD_OUTPUT_END_MARKER);
    const rawIdx = tail.indexOf(PRIOR_RAW);
    expect(rawIdx).toBeGreaterThan(markerStart);
    expect(rawIdx).toBeLessThan(markerEnd);
  });

  it('includes the validation error message', () => {
    const tail = buildRepairTail(
      SAMPLE_BACKSTORY,
      SAMPLE_PAGE_SNAPSHOT,
      PRIOR_RAW,
      VALIDATION_ERROR,
    );
    expect(tail).toContain(VALIDATION_ERROR);
  });

  it('includes backstory and page snapshot (super-set of buildDynamicTail)', () => {
    const tail = buildRepairTail(
      SAMPLE_BACKSTORY,
      SAMPLE_PAGE_SNAPSHOT,
      PRIOR_RAW,
      VALIDATION_ERROR,
    );
    expect(tail).toContain('BACKSTORY:');
    expect(tail).toContain('PAGE_SNAPSHOT:');
    expect(tail).toContain(SAMPLE_PAGE_SNAPSHOT);
  });
});
