/**
 * backstoryEnums.test.ts — spec-pin for all backstory sub-schema enum
 * value sets (spec §2 #5 + growth/ab/pricing-page-2026apr/personas/backstories.md).
 *
 * The existing backstory.test.ts only validates a fixture round-trip and
 * one bad-enum rejection. This file pins every enum's count + values so
 * a silent removal or addition is caught without a fixture-round-trip test.
 */

import { describe, it, expect } from 'vitest';
import {
  Stage,
  TeamSize,
  ManagedPostgres,
  CurrentPain,
  EntryPoint,
  Regulated,
  PostgresDepth,
  BudgetAuthority,
  RoleArchetype,
} from '../src/backstory.js';

describe('Stage enum (spec §2 #5)', () => {
  it('has exactly 4 values', () => {
    expect(Stage.options).toHaveLength(4);
  });

  it('contains seed, seed+, series_a, series_b', () => {
    expect(Stage.options).toContain('seed');
    expect(Stage.options).toContain('seed+');
    expect(Stage.options).toContain('series_a');
    expect(Stage.options).toContain('series_b');
  });

  it('rejects unknown stage', () => {
    expect(Stage.safeParse('series_c').success).toBe(false);
  });
});

describe('TeamSize union (spec §2 #5 — fixed quartiles)', () => {
  it('accepts all four valid team sizes', () => {
    for (const n of [2, 6, 12, 20]) {
      expect(TeamSize.safeParse(n).success).toBe(true);
    }
  });

  it('rejects sizes outside the fixed set', () => {
    for (const n of [0, 1, 3, 5, 10, 15, 25, 50]) {
      expect(TeamSize.safeParse(n).success).toBe(false);
    }
  });
});

describe('ManagedPostgres enum (spec §2 #5)', () => {
  it('has exactly 5 values', () => {
    expect(ManagedPostgres.options).toHaveLength(5);
  });

  it('contains supabase, neon, rds, aurora, cloud_sql', () => {
    expect(ManagedPostgres.options).toContain('supabase');
    expect(ManagedPostgres.options).toContain('neon');
    expect(ManagedPostgres.options).toContain('rds');
    expect(ManagedPostgres.options).toContain('aurora');
    expect(ManagedPostgres.options).toContain('cloud_sql');
  });
});

describe('CurrentPain enum (spec §2 #5)', () => {
  it('has exactly 6 values', () => {
    expect(CurrentPain.options).toHaveLength(6);
  });

  it('contains all 6 pain types', () => {
    const expected = [
      'recent_outage',
      'slow_queries',
      'bad_migration_fear',
      'cost_creep',
      'upcoming_scale_event',
      'post_mortem_in_hand',
    ];
    for (const v of expected) {
      expect(CurrentPain.options).toContain(v);
    }
  });
});

describe('EntryPoint enum (spec §2 #5)', () => {
  it('has exactly 6 values', () => {
    expect(EntryPoint.options).toHaveLength(6);
  });

  it('contains all 6 entry points', () => {
    const expected = [
      'hacker_news',
      'newsletter',
      'vc_referral',
      'google_search',
      'postgres_blog_footer',
      'conference_booth_followup',
    ];
    for (const v of expected) {
      expect(EntryPoint.options).toContain(v);
    }
  });
});

describe('Regulated enum (spec §2 #5)', () => {
  it('has exactly 3 values', () => {
    expect(Regulated.options).toHaveLength(3);
  });

  it('contains no, lightly, yes', () => {
    expect(Regulated.options).toContain('no');
    expect(Regulated.options).toContain('lightly');
    expect(Regulated.options).toContain('yes');
  });
});

describe('PostgresDepth enum (spec §2 #5)', () => {
  it('has exactly 3 values', () => {
    expect(PostgresDepth.options).toHaveLength(3);
  });

  it('contains light, medium, deep', () => {
    expect(PostgresDepth.options).toContain('light');
    expect(PostgresDepth.options).toContain('medium');
    expect(PostgresDepth.options).toContain('deep');
  });
});

describe('BudgetAuthority enum (spec §2 #5)', () => {
  it('has exactly 4 values', () => {
    expect(BudgetAuthority.options).toHaveLength(4);
  });

  it('contains all 4 authority levels', () => {
    expect(BudgetAuthority.options).toContain('self');
    expect(BudgetAuthority.options).toContain('needs_founder_signoff');
    expect(BudgetAuthority.options).toContain('needs_manager_signoff');
    expect(BudgetAuthority.options).toContain('needs_board_visibility');
  });
});

describe('RoleArchetype enum (spec §2 #5)', () => {
  it('has exactly 2 values', () => {
    expect(RoleArchetype.options).toHaveLength(2);
  });

  it('contains founder_or_eng_lead and ic_engineer', () => {
    expect(RoleArchetype.options).toContain('founder_or_eng_lead');
    expect(RoleArchetype.options).toContain('ic_engineer');
  });

  it('rejects unknown role', () => {
    expect(RoleArchetype.safeParse('data_scientist').success).toBe(false);
  });
});
