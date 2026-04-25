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
});
