import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { redact, REDACTOR_VERSION, LABEL_PROXIMITY_CHARS, type RedactionKind } from '../src/redactor.js';

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

// §6.1 boundary fixtures: the spec defines exact distances that must be
// tested. Each case builds `input = prefix + gap + body` where gap may
// include spaces or newlines (all count toward the 32-char window).
// Cases with `custom_input` use that directly instead.
type BoundaryCase = {
  label: string;
  body: string;
  expect: 'redact' | 'leave';
  why: string;
} & (
  | { custom_input: string; prefix?: undefined; gap?: undefined }
  | { custom_input?: undefined; prefix: string; gap: string }
);
type BoundaryFixture = { cases: BoundaryCase[] };

const positives = JSON.parse(
  readFileSync(resolve(here, 'fixtures/redactor-positive.json'), 'utf8'),
) as PositiveFixture;

const falsePositives = JSON.parse(
  readFileSync(resolve(here, 'fixtures/redactor-false-positive.json'), 'utf8'),
) as FalsePositiveFixture;

const boundary = JSON.parse(
  readFileSync(resolve(here, 'fixtures/redactor-boundary.json'), 'utf8'),
) as BoundaryFixture;

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

// §6.1 boundary suite — tests the 32-char proximity window for the
// labeled-context rule. The spec says:
//   label 31 chars away → redact
//   label 33 chars away → don't redact
//   two labels at 29 and 35 chars → redact (the 29-char label fires)
//   label separated by a newline → redact (newlines count toward distance)
//   multiple overlapping labels → redact (each label's window checked)
describe('redactor — spec §6.1 labeled-context boundary fixtures', () => {
  for (const c of boundary.cases) {
    it(`boundary: ${c.label}`, () => {
      const input = c.custom_input ?? `${c.prefix}${c.gap}${c.body}`;
      const r = redact(input);
      if (c.expect === 'redact') {
        expect(r.redacted).not.toContain(c.body);
        expect(r.redacted).toContain('[REDACTED:labeled_secret]');
      } else {
        // leave — body must survive unmodified
        expect(r.redacted).toContain(c.body);
        expect(r.redacted).not.toContain('[REDACTED:labeled_secret]');
      }
    });
  }
});

// Spec-pins for exported constants
describe('redactor spec-pin constants (spec §5.9 + §6.1)', () => {
  it('REDACTOR_VERSION is 1', () => {
    expect(REDACTOR_VERSION).toBe(1);
  });

  it('LABEL_PROXIMITY_CHARS is 32', () => {
    expect(LABEL_PROXIMITY_CHARS).toBe(32);
  });
});
