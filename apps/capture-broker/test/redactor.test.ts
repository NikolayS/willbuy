import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { redact, REDACTOR_VERSION, type RedactionKind } from '../src/redactor.js';

// Spec §5.9 + §6.1: the redactor MUST have a positive AND a false-positive
// fixture suite, and the labeled-context boundary rule MUST cleanly
// separate them. These two fixture files drive both halves of the test.
//
// The positive fixtures store `prefix` + `body` separately (rather than
// the joined `value`) so that the committed JSON never contains the
// literal patterns GitHub's secret scanner flags (`xoxb-…`, `glpat-…`,
// etc). We concatenate at runtime to produce the actual test input.

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));

type PositiveFixture = {
  cases: Array<{ label: string; prefix: string; body: string; kind: RedactionKind; why: string }>;
};
type FalsePositiveFixture = { cases: Array<{ label: string; value: string; why: string }> };

const positives = JSON.parse(
  readFileSync(resolve(here, 'fixtures/redactor-positive.json'), 'utf8'),
) as PositiveFixture;

const falsePositives = JSON.parse(
  readFileSync(resolve(here, 'fixtures/redactor-false-positive.json'), 'utf8'),
) as FalsePositiveFixture;

describe('redactor — spec §5.9 positive fixtures', () => {
  for (const c of positives.cases) {
    const value = c.prefix + c.body;
    it(`redacts: ${c.label}`, () => {
      const r = redact(value);
      expect(r.redacted).toContain('[REDACTED:');
      // The body MUST disappear from output. (Some labeled-context cases
      // keep the LABEL prefix, e.g. `api_key=` survives.)
      expect(r.redacted).not.toContain(c.body);
      expect(r.redactor_v).toBe(REDACTOR_VERSION);
      // The case declares which detector kind should fire — assert it.
      expect(r.counts[c.kind] ?? 0).toBeGreaterThan(0);
    });
  }
});

describe('redactor — spec §5.9 false-positive fixtures (boundary rule)', () => {
  for (const c of falsePositives.cases) {
    it(`leaves alone: ${c.label}`, () => {
      const r = redact(c.value);
      expect(r.redacted).toBe(c.value);
      expect(Object.keys(r.counts)).toHaveLength(0);
    });
  }
});
