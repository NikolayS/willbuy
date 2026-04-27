/**
 * backstory-enums-pin.test.ts — spec-pins for Zod enum values in
 * packages/shared/src/backstory.ts (spec §2 #5).
 *
 * Each Zod enum defines the exact valid values for a backstory field.
 * Renaming any value (e.g. 'series_a' → 'series-a') silently breaks
 * parsing for any existing backstory with that value. Adding a value
 * extends the acceptance surface without a spec change. Removing one
 * causes rejections for previously-valid data.
 *
 * The existing backstory.test.ts only tests parse/reject via fixture —
 * the specific enum member strings are not directly asserted.
 *
 * TeamSize uses z.union([z.literal(...)]) rather than z.enum(), so we
 * test it by parsing valid and invalid values rather than via .options.
 */

import { describe, expect, it } from 'vitest';
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

describe('Stage enum spec-pin', () => {
  it('has exactly 4 options', () => {
    expect(Stage.options).toHaveLength(4);
  });

  it('accepts "seed"', () => {
    expect(() => Stage.parse('seed')).not.toThrow();
  });

  it('accepts "seed+"', () => {
    expect(() => Stage.parse('seed+')).not.toThrow();
  });

  it('accepts "series_a"', () => {
    expect(() => Stage.parse('series_a')).not.toThrow();
  });

  it('accepts "series_b"', () => {
    expect(() => Stage.parse('series_b')).not.toThrow();
  });

  it('rejects "series-a" (hyphen instead of underscore)', () => {
    expect(() => Stage.parse('series-a')).toThrow();
  });

  it('rejects "series_c"', () => {
    expect(() => Stage.parse('series_c')).toThrow();
  });
});

describe('TeamSize union spec-pin', () => {
  it('accepts 2', () => {
    expect(() => TeamSize.parse(2)).not.toThrow();
  });

  it('accepts 6', () => {
    expect(() => TeamSize.parse(6)).not.toThrow();
  });

  it('accepts 12', () => {
    expect(() => TeamSize.parse(12)).not.toThrow();
  });

  it('accepts 20', () => {
    expect(() => TeamSize.parse(20)).not.toThrow();
  });

  it('rejects 5 (not a valid team size)', () => {
    expect(() => TeamSize.parse(5)).toThrow();
  });

  it('rejects 100', () => {
    expect(() => TeamSize.parse(100)).toThrow();
  });
});

describe('ManagedPostgres enum spec-pin', () => {
  it('has exactly 5 options', () => {
    expect(ManagedPostgres.options).toHaveLength(5);
  });

  it('accepts "supabase"', () => {
    expect(() => ManagedPostgres.parse('supabase')).not.toThrow();
  });

  it('accepts "neon"', () => {
    expect(() => ManagedPostgres.parse('neon')).not.toThrow();
  });

  it('accepts "rds"', () => {
    expect(() => ManagedPostgres.parse('rds')).not.toThrow();
  });

  it('rejects "mongodb"', () => {
    expect(() => ManagedPostgres.parse('mongodb')).toThrow();
  });
});

describe('Regulated enum spec-pin', () => {
  it('has exactly 3 options', () => {
    expect(Regulated.options).toHaveLength(3);
  });

  it('accepts "no", "lightly", "yes"', () => {
    expect(() => Regulated.parse('no')).not.toThrow();
    expect(() => Regulated.parse('lightly')).not.toThrow();
    expect(() => Regulated.parse('yes')).not.toThrow();
  });

  it('rejects "maybe"', () => {
    expect(() => Regulated.parse('maybe')).toThrow();
  });
});

describe('PostgresDepth enum spec-pin', () => {
  it('has exactly 3 options', () => {
    expect(PostgresDepth.options).toHaveLength(3);
  });

  it('accepts "light", "medium", "deep"', () => {
    expect(() => PostgresDepth.parse('light')).not.toThrow();
    expect(() => PostgresDepth.parse('medium')).not.toThrow();
    expect(() => PostgresDepth.parse('deep')).not.toThrow();
  });
});

describe('BudgetAuthority enum spec-pin', () => {
  it('has exactly 4 options', () => {
    expect(BudgetAuthority.options).toHaveLength(4);
  });

  it('accepts "self"', () => {
    expect(() => BudgetAuthority.parse('self')).not.toThrow();
  });

  it('accepts "needs_board_visibility"', () => {
    expect(() => BudgetAuthority.parse('needs_board_visibility')).not.toThrow();
  });
});

describe('RoleArchetype enum spec-pin', () => {
  it('has exactly 2 options', () => {
    expect(RoleArchetype.options).toHaveLength(2);
  });

  it('accepts "founder_or_eng_lead"', () => {
    expect(() => RoleArchetype.parse('founder_or_eng_lead')).not.toThrow();
  });

  it('accepts "ic_engineer"', () => {
    expect(() => RoleArchetype.parse('ic_engineer')).not.toThrow();
  });

  it('rejects "founder" (truncated form)', () => {
    expect(() => RoleArchetype.parse('founder')).toThrow();
  });
});
