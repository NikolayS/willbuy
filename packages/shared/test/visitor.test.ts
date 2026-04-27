import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VisitorOutput } from '../src/visitor.js';

const here = dirname(fileURLToPath(import.meta.url));
const validFixture = JSON.parse(
  readFileSync(resolve(here, 'fixtures/valid-visitor.json'), 'utf8'),
);

// ── Field cap spec-pins ────────────────────────────────────────────────────
// The existing reject-at-cap tests verify that cap+1 is rejected but do not
// verify that cap itself is accepted (off-by-one in the cap could silently
// reduce the allowed size). Each pin below asserts both: cap accepts, cap+1
// rejects. Values come from the spec §2 #15 cap table.

describe('VisitorOutput field cap spec-pins (spec §2 #15)', () => {
  it('first_impression cap=400: accepts exactly 400 chars', () => {
    const v = { ...validFixture, first_impression: 'a'.repeat(400) };
    expect(() => VisitorOutput.parse(v)).not.toThrow();
  });

  it('first_impression cap=400: rejects 401 chars', () => {
    const v = { ...validFixture, first_impression: 'a'.repeat(401) };
    expect(() => VisitorOutput.parse(v)).toThrow();
  });

  it('reasoning cap=1200: accepts exactly 1200 chars', () => {
    const v = { ...validFixture, reasoning: 'a'.repeat(1200) };
    expect(() => VisitorOutput.parse(v)).not.toThrow();
  });

  it('reasoning cap=1200: rejects 1201 chars', () => {
    const v = { ...validFixture, reasoning: 'a'.repeat(1201) };
    expect(() => VisitorOutput.parse(v)).toThrow();
  });

  it('score0to10 (will_to_buy): accepts 0 (minimum)', () => {
    const v = { ...validFixture, will_to_buy: 0 };
    expect(() => VisitorOutput.parse(v)).not.toThrow();
  });

  it('score0to10 (will_to_buy): accepts 10 (maximum)', () => {
    const v = { ...validFixture, will_to_buy: 10 };
    expect(() => VisitorOutput.parse(v)).not.toThrow();
  });

  it('score0to10 (will_to_buy): rejects 11', () => {
    const v = { ...validFixture, will_to_buy: 11 };
    expect(() => VisitorOutput.parse(v)).toThrow();
  });

  it('score0to10 (will_to_buy): rejects -1', () => {
    const v = { ...validFixture, will_to_buy: -1 };
    expect(() => VisitorOutput.parse(v)).toThrow();
  });

  it('shortStringList (questions): accepts exactly 10 items', () => {
    const v = { ...validFixture, questions: Array(10).fill('q') };
    expect(() => VisitorOutput.parse(v)).not.toThrow();
  });

  it('shortStringList (questions): rejects 11 items', () => {
    const v = { ...validFixture, questions: Array(11).fill('q') };
    expect(() => VisitorOutput.parse(v)).toThrow();
  });

  it('shortStringList item cap=200: accepts exactly 200 chars', () => {
    const v = { ...validFixture, questions: ['a'.repeat(200)] };
    expect(() => VisitorOutput.parse(v)).not.toThrow();
  });

  it('shortStringList item cap=200: rejects 201 chars', () => {
    const v = { ...validFixture, questions: ['a'.repeat(201)] };
    expect(() => VisitorOutput.parse(v)).toThrow();
  });
});

describe('VisitorOutput (spec §2 #15)', () => {
  it('parses a known-valid fixture', () => {
    const parsed = VisitorOutput.parse(validFixture);
    expect(parsed.next_action).toBe('contact_sales');
  });

  it('rejects when a required field is missing', () => {
    const withoutReasoning: Record<string, unknown> = { ...validFixture };
    delete withoutReasoning['reasoning'];
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
