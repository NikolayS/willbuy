/**
 * reportSchemaPin.test.ts — spec-pin for Report sub-schema enum values
 * and structural constraints (spec §5.18).
 *
 * Report is not tested anywhere in packages/shared/test/. This file pins
 * the public enum types and their exact value sets so a silent change
 * breaks CI rather than silently corrupting the report wire format.
 *
 * Spec refs:
 *   §5.18 — report visualization wire shape (seven elements).
 *   §2 #19 — verdict enum: better/worse/inconclusive.
 *   §5.18 #2 — swing enum: a_wins/tie/b_wins.
 *   §5.18 #3 — histogram.bins length=11 (0..10 inclusive).
 *   §5.18 #5 — tier enum: 6 values including none/hobby.
 *   §5.18 #6 — themeCategory: blockers/objections/confusions/questions.
 */

import { describe, it, expect } from 'vitest';
import {
  Report,
} from '../src/report.js';

// Access the internal sub-schemas through shape introspection.
// Report is a z.object(), so .shape exposes all field schemas.
const { headline, histograms, tier_picked } = Report.shape;

describe('headline.verdict enum (spec §2 #19)', () => {
  const verdictSchema = headline.shape.verdict;

  it('has exactly 3 verdict values', () => {
    expect(verdictSchema.options).toHaveLength(3);
  });

  it('contains better, worse, inconclusive', () => {
    expect(verdictSchema.options).toContain('better');
    expect(verdictSchema.options).toContain('worse');
    expect(verdictSchema.options).toContain('inconclusive');
  });

  it('rejects unknown verdict', () => {
    expect(verdictSchema.safeParse('neutral').success).toBe(false);
  });
});

describe('histogram.bins length constraint (spec §5.18 #3)', () => {
  const histogramElement = histograms.element;
  const binsSchema = histogramElement.shape.bins;

  it('accepts bins array of exactly 11 integers', () => {
    const eleven = Array.from({ length: 11 }, () => 0);
    expect(binsSchema.safeParse(eleven).success).toBe(true);
  });

  it('rejects bins array of 10 integers', () => {
    const ten = Array.from({ length: 10 }, () => 0);
    expect(binsSchema.safeParse(ten).success).toBe(false);
  });

  it('rejects bins array of 12 integers', () => {
    const twelve = Array.from({ length: 12 }, () => 0);
    expect(binsSchema.safeParse(twelve).success).toBe(false);
  });

  it('rejects negative bin counts', () => {
    const withNeg = Array.from({ length: 11 }, (_, i) => (i === 5 ? -1 : 0));
    expect(binsSchema.safeParse(withNeg).success).toBe(false);
  });
});

describe('tier enum (spec §5.18 #5)', () => {
  // Access via tier_picked element's counts record key schema.
  const tierRowElement = tier_picked.element;
  const tierSchema = tierRowElement.shape.counts.keySchema;

  it('has exactly 6 tier values', () => {
    expect(tierSchema.options).toHaveLength(6);
  });

  it('contains none, hobby, express, starter, scale, enterprise', () => {
    for (const t of ['none', 'hobby', 'express', 'starter', 'scale', 'enterprise']) {
      expect(tierSchema.options).toContain(t);
    }
  });

  it('rejects unknown tier string', () => {
    expect(tierSchema.safeParse('premium').success).toBe(false);
  });
});

describe('Report arrays min=1 max=2 (spec §5.18)', () => {
  it('histograms array enforces min=1', () => {
    expect(histograms.safeParse([]).success).toBe(false);
  });

  it('histograms array enforces max=2', () => {
    // Build 3 minimal valid histogram entries to hit max=2.
    const hist = { variant: 'A', bins: Array(11).fill(0), mean: 5, median: 5 };
    expect(histograms.safeParse([hist, hist, hist]).success).toBe(false);
  });
});
