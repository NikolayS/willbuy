import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Backstory } from '../src/backstory.js';

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

  it('rejects an invalid TeamSize (must be 2, 6, 12, or 20)', () => {
    const bad = { ...validFixture, team_size: 5 };
    expect(Backstory.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty name', () => {
    const bad = { ...validFixture, name: '' };
    expect(Backstory.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { role_archetype: _omit, ...incomplete } = validFixture as Record<string, unknown>;
    expect(Backstory.safeParse(incomplete).success).toBe(false);
  });

  it('rejects an extra unknown field (.strict())', () => {
    const bad = { ...validFixture, unknown_field: 'unexpected' };
    expect(Backstory.safeParse(bad).success).toBe(false);
  });

  it('accepts all four valid TeamSize values (2, 6, 12, 20)', () => {
    for (const size of [2, 6, 12, 20]) {
      const ok = { ...validFixture, team_size: size };
      expect(Backstory.safeParse(ok).success, `team_size=${size} should be valid`).toBe(true);
    }
  });
});
