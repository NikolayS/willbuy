import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VisitorOutput } from '../src/visitor.js';

const here = dirname(fileURLToPath(import.meta.url));
const validFixture = JSON.parse(
  readFileSync(resolve(here, 'fixtures/valid-visitor.json'), 'utf8'),
);

describe('VisitorOutput (spec §2 #15)', () => {
  it('parses a known-valid fixture', () => {
    const parsed = VisitorOutput.parse(validFixture);
    expect(parsed.next_action).toBe('contact_sales');
  });
});
