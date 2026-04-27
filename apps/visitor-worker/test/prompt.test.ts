/**
 * prompt.test.ts — unit tests for prompt.ts (spec §2 #14, §2 #15).
 *
 * Pure functions: no I/O, no LLM calls, no mocking needed.
 *
 * Tests:
 *   1. buildStaticPrefix() is non-empty and byte-identical across calls.
 *   2. buildDynamicTail() embeds "BACKSTORY:" header and all 10 backstory
 *      fields in stable order, followed by "PAGE_SNAPSHOT:" and the snapshot.
 *   3. buildRepairTail() wraps the prior output between the sentinel markers
 *      (never as assistant role), embeds the validation_error, and includes
 *      the dynamic tail content.
 *   4. PRIOR_BAD_OUTPUT_MARKER is a user-role structural sentinel, not
 *      empty (schema-repair assistant-role invariant §2 #14).
 */

import { describe, expect, it } from 'vitest';
import type { BackstoryT } from '@willbuy/shared';

import {
  buildDynamicTail,
  buildRepairTail,
  buildStaticPrefix,
  PRIOR_BAD_OUTPUT_END_MARKER,
  PRIOR_BAD_OUTPUT_MARKER,
} from '../src/prompt.js';

// ── Fixture backstory ─────────────────────────────────────────────────────────

const BACKSTORY: BackstoryT = {
  name: 'Maya',
  role_archetype: 'founder_or_eng_lead',
  stage: 'series_a',
  team_size: 12,
  managed_postgres: 'supabase',
  current_pain: 'upcoming_scale_event',
  entry_point: 'newsletter',
  regulated: 'no',
  postgres_depth: 'light',
  budget_authority: 'self',
};

const SNAPSHOT = '<html><body><h1>Pricing</h1></body></html>';

// ── buildStaticPrefix() ───────────────────────────────────────────────────────

describe('buildStaticPrefix()', () => {
  it('returns a non-empty string', () => {
    expect(buildStaticPrefix().length).toBeGreaterThan(0);
  });

  it('is byte-identical across calls (cacheability invariant §2 #14)', () => {
    expect(buildStaticPrefix()).toBe(buildStaticPrefix());
  });

  it('mentions the VisitorOutput schema (so the model knows the output contract)', () => {
    expect(buildStaticPrefix()).toContain('VisitorOutput');
  });

  it('names the next_action enum values so the model has the full list', () => {
    const prefix = buildStaticPrefix();
    expect(prefix).toContain('purchase_paid_today');
    expect(prefix).toContain('contact_sales');
    expect(prefix).toContain('leave');
  });
});

// ── buildDynamicTail() ────────────────────────────────────────────────────────

describe('buildDynamicTail()', () => {
  it('contains the BACKSTORY: section header', () => {
    const tail = buildDynamicTail(BACKSTORY, SNAPSHOT);
    expect(tail).toContain('BACKSTORY:');
  });

  it('contains the PAGE_SNAPSHOT: section header', () => {
    const tail = buildDynamicTail(BACKSTORY, SNAPSHOT);
    expect(tail).toContain('PAGE_SNAPSHOT:');
  });

  it('PAGE_SNAPSHOT: appears after BACKSTORY:', () => {
    const tail = buildDynamicTail(BACKSTORY, SNAPSHOT);
    expect(tail.indexOf('BACKSTORY:')).toBeLessThan(tail.indexOf('PAGE_SNAPSHOT:'));
  });

  it('embeds the page snapshot content verbatim', () => {
    const tail = buildDynamicTail(BACKSTORY, SNAPSHOT);
    expect(tail).toContain(SNAPSHOT);
  });

  it('renders all 10 backstory fields', () => {
    const tail = buildDynamicTail(BACKSTORY, SNAPSHOT);
    const fields = [
      'name',
      'role_archetype',
      'stage',
      'team_size',
      'managed_postgres',
      'current_pain',
      'entry_point',
      'regulated',
      'postgres_depth',
      'budget_authority',
    ];
    for (const f of fields) {
      expect(tail).toContain(`${f}:`);
    }
  });

  it('renders backstory field values from the fixture', () => {
    const tail = buildDynamicTail(BACKSTORY, SNAPSHOT);
    expect(tail).toContain('Maya');
    expect(tail).toContain('founder_or_eng_lead');
    expect(tail).toContain('supabase');
  });
});

// ── buildRepairTail() ─────────────────────────────────────────────────────────

describe('buildRepairTail()', () => {
  const PRIOR_OUTPUT = '{"invalid":"json_shape"}';
  const VALIDATION_ERROR = 'missing required field: reasoning';

  it('contains the PRIOR_BAD_OUTPUT_MARKER sentinel', () => {
    const tail = buildRepairTail(BACKSTORY, SNAPSHOT, PRIOR_OUTPUT, VALIDATION_ERROR);
    expect(tail).toContain(PRIOR_BAD_OUTPUT_MARKER);
  });

  it('contains the PRIOR_BAD_OUTPUT_END_MARKER sentinel', () => {
    const tail = buildRepairTail(BACKSTORY, SNAPSHOT, PRIOR_OUTPUT, VALIDATION_ERROR);
    expect(tail).toContain(PRIOR_BAD_OUTPUT_END_MARKER);
  });

  it('prior output is wrapped between begin and end markers', () => {
    const tail = buildRepairTail(BACKSTORY, SNAPSHOT, PRIOR_OUTPUT, VALIDATION_ERROR);
    const begin = tail.indexOf(PRIOR_BAD_OUTPUT_MARKER);
    const end = tail.indexOf(PRIOR_BAD_OUTPUT_END_MARKER);
    const between = tail.slice(begin + PRIOR_BAD_OUTPUT_MARKER.length, end);
    expect(between).toContain(PRIOR_OUTPUT);
  });

  it('embeds the validation_error string', () => {
    const tail = buildRepairTail(BACKSTORY, SNAPSHOT, PRIOR_OUTPUT, VALIDATION_ERROR);
    expect(tail).toContain(VALIDATION_ERROR);
  });

  it('includes BACKSTORY: content (dynamic tail embedded)', () => {
    const tail = buildRepairTail(BACKSTORY, SNAPSHOT, PRIOR_OUTPUT, VALIDATION_ERROR);
    expect(tail).toContain('BACKSTORY:');
    expect(tail).toContain('Maya');
  });

  it('contains the re-emit instruction', () => {
    const tail = buildRepairTail(BACKSTORY, SNAPSHOT, PRIOR_OUTPUT, VALIDATION_ERROR);
    expect(tail).toContain('Re-emit');
  });
});

// ── Marker constants ──────────────────────────────────────────────────────────

describe('PRIOR_BAD_OUTPUT_MARKER', () => {
  it('is a non-empty string (structural sentinel — not empty)', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER.length).toBeGreaterThan(0);
    expect(PRIOR_BAD_OUTPUT_END_MARKER.length).toBeGreaterThan(0);
  });

  it('begin and end markers are distinct', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER).not.toBe(PRIOR_BAD_OUTPUT_END_MARKER);
  });
});
