import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Backstory,
  Stage,
  ManagedPostgres,
  CurrentPain,
  EntryPoint,
  Regulated,
  PostgresDepth,
  BudgetAuthority,
  RoleArchetype,
} from '../src/backstory.js';

const here = dirname(fileURLToPath(import.meta.url));
const validFixture = JSON.parse(
  readFileSync(resolve(here, 'fixtures/valid-backstory.json'), 'utf8'),
);

describe('Backstory (spec §2 #5 + personas/backstories.md)', () => {
  it('parses a known-valid fixture', () => {
    const parsed = Backstory.parse(validFixture);
    expect(parsed.name).toBe('Maya');
  });

  it('rejects a backstory with a bad enum value', () => {
    const bad = { ...validFixture, managed_postgres: 'mongodb' };
    expect(() => Backstory.parse(bad)).toThrow();
  });
});

// ── Backstory enum spec-pins (spec §2 #5, personas/backstories.md) ────────────

describe('Backstory sub-schemas — enum value pins (spec §2 #5)', () => {
  it('Stage has exactly 4 values: seed, seed+, series_a, series_b', () => {
    const values = Stage.options;
    expect(values).toEqual(['seed', 'seed+', 'series_a', 'series_b']);
    expect(values).toHaveLength(4);
  });

  it('ManagedPostgres has 5 providers: supabase, neon, rds, aurora, cloud_sql', () => {
    const values = ManagedPostgres.options;
    expect(values).toContain('supabase');
    expect(values).toContain('neon');
    expect(values).toContain('rds');
    expect(values).toContain('aurora');
    expect(values).toContain('cloud_sql');
    expect(values).toHaveLength(5);
  });

  it('CurrentPain has 6 pain points', () => {
    const values = CurrentPain.options;
    expect(values).toContain('recent_outage');
    expect(values).toContain('slow_queries');
    expect(values).toContain('bad_migration_fear');
    expect(values).toContain('cost_creep');
    expect(values).toContain('upcoming_scale_event');
    expect(values).toContain('post_mortem_in_hand');
    expect(values).toHaveLength(6);
  });

  it('EntryPoint has 6 sources', () => {
    const values = EntryPoint.options;
    expect(values).toContain('hacker_news');
    expect(values).toContain('newsletter');
    expect(values).toContain('vc_referral');
    expect(values).toContain('google_search');
    expect(values).toContain('postgres_blog_footer');
    expect(values).toContain('conference_booth_followup');
    expect(values).toHaveLength(6);
  });

  it('Regulated has 3 values: no, lightly, yes', () => {
    expect(Regulated.options).toEqual(['no', 'lightly', 'yes']);
  });

  it('PostgresDepth has 3 values: light, medium, deep', () => {
    expect(PostgresDepth.options).toEqual(['light', 'medium', 'deep']);
  });

  it('BudgetAuthority has 4 values', () => {
    const values = BudgetAuthority.options;
    expect(values).toContain('self');
    expect(values).toContain('needs_founder_signoff');
    expect(values).toContain('needs_manager_signoff');
    expect(values).toContain('needs_board_visibility');
    expect(values).toHaveLength(4);
  });

  it('RoleArchetype has exactly 2 values: founder_or_eng_lead and ic_engineer', () => {
    expect(RoleArchetype.options).toEqual(['founder_or_eng_lead', 'ic_engineer']);
    expect(RoleArchetype.options).toHaveLength(2);
  });
});
