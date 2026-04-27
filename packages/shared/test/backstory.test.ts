import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Backstory, TeamSize } from '../src/backstory.js';

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

// ── TeamSize spec-pin (spec §2 #5, personas/backstories.md) ──────────────────
//
// TeamSize is z.union([z.literal(2), z.literal(6), z.literal(12), z.literal(20)]).
// The 4 fixed quartiles encode deliberate ICPs; adding a 5th or changing a value
// silently changes what backstories the system accepts.

describe('TeamSize spec-pin (spec §2 #5)', () => {
  it('accepts all four valid literal values: 2, 6, 12, 20', () => {
    for (const n of [2, 6, 12, 20]) {
      expect(() => TeamSize.parse(n)).not.toThrow();
      expect(TeamSize.parse(n)).toBe(n);
    }
  });

  it('rejects team sizes not in the allowed set', () => {
    for (const bad of [0, 1, 3, 5, 7, 10, 11, 15, 25, 50, 100]) {
      expect(() => TeamSize.parse(bad)).toThrow();
    }
  });

  it('rejects non-integer inputs (string, null, undefined)', () => {
    expect(() => TeamSize.parse('12')).toThrow();
    expect(() => TeamSize.parse(null)).toThrow();
    expect(() => TeamSize.parse(undefined)).toThrow();
  });
});
