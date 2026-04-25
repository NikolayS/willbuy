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

  it('rejects when a required field is missing', () => {
    const { reasoning: _omit, ...withoutReasoning } = validFixture;
    expect(() => VisitorOutput.parse(withoutReasoning)).toThrow();
  });

  it('rejects an oversized field (first_impression > 400 chars per §2 #15)', () => {
    const oversized = {
      ...validFixture,
      first_impression: 'x'.repeat(401),
    };
    expect(() => VisitorOutput.parse(oversized)).toThrow();
  });

  it('rejects an out-of-range integer (will_to_buy must be 0–10 per §2 #15)', () => {
    const outOfRange = { ...validFixture, will_to_buy: 11 };
    expect(() => VisitorOutput.parse(outOfRange)).toThrow();
  });

  it('rejects a wrong enum value for next_action', () => {
    const wrongEnum = { ...validFixture, next_action: 'signup_free' };
    expect(() => VisitorOutput.parse(wrongEnum)).toThrow();
  });

  it('rejects a non-array array (questions must be string[])', () => {
    const notAnArray = {
      ...validFixture,
      questions: 'one big string instead of array',
    };
    expect(() => VisitorOutput.parse(notAnArray)).toThrow();
  });

  it('rejects out-of-range confidence (must be 0–10 per §2 #15)', () => {
    const bad = { ...validFixture, confidence: -1 };
    expect(() => VisitorOutput.parse(bad)).toThrow();
  });

  it('rejects oversized reasoning (> 1200 chars per §2 #15)', () => {
    const bad = { ...validFixture, reasoning: 'r'.repeat(1201) };
    expect(() => VisitorOutput.parse(bad)).toThrow();
  });
});
