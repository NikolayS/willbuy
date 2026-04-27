/**
 * report.test.ts — Zod schema validation for the §5.18 Report wire shape.
 *
 * The Report schema is the contract between the aggregator and the report
 * page. These tests assert that:
 *   1. The web fixture (used as the canonical happy-path) parses correctly.
 *   2. Key constraint violations are caught (required fields, min/max,
 *      enum values, nullable fields).
 *
 * We deliberately import the web fixture rather than duplicating it — one
 * source of truth for the canonical wire shape.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Report } from '../src/report.js';

const here = dirname(fileURLToPath(import.meta.url));
// The report.fixture.json lives in apps/web/test/fixtures — use it as canonical.
const fixtureRaw = JSON.parse(
  readFileSync(
    resolve(here, '../../../apps/web/test/fixtures/report.fixture.json'),
    'utf8',
  ),
);

describe('Report schema (spec §5.18)', () => {
  it('parses the canonical web fixture without errors', () => {
    const result = Report.safeParse(fixtureRaw);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('rejects when meta.slug is missing', () => {
    const bad = { ...fixtureRaw, meta: { low_power: false } };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('rejects when headline.verdict is not a valid enum', () => {
    const bad = {
      ...fixtureRaw,
      headline: { ...fixtureRaw.headline, verdict: 'uncertain' },
    };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('rejects when headline.paired_t_p is out of [0,1]', () => {
    const bad = {
      ...fixtureRaw,
      headline: { ...fixtureRaw.headline, paired_t_p: 1.5 },
    };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('rejects histograms with 0 entries (min 1 required)', () => {
    const bad = { ...fixtureRaw, histograms: [] };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('rejects histograms with 3 entries (max 2)', () => {
    const bad = {
      ...fixtureRaw,
      histograms: [
        fixtureRaw.histograms[0],
        fixtureRaw.histograms[0],
        fixtureRaw.histograms[0],
      ],
    };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('rejects a histogram whose bins array has fewer than 11 entries', () => {
    const shortBins = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 10 entries
    const bad = {
      ...fixtureRaw,
      histograms: [{ ...fixtureRaw.histograms[0], bins: shortBins }],
    };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('rejects a paired_dot with swing not in enum', () => {
    const badDot = { ...fixtureRaw.paired_dots[0], swing: 'c_wins' };
    const bad = {
      ...fixtureRaw,
      paired_dots: [badDot, ...fixtureRaw.paired_dots.slice(1)],
    };
    expect(Report.safeParse(bad).success).toBe(false);
  });

  it('accepts score_b=null and verdict_b=null on personas (single-variant)', () => {
    const singleVariant = {
      ...fixtureRaw,
      personas: fixtureRaw.personas.map((p: Record<string, unknown>) => ({
        ...p,
        score_b: null,
        verdict_b: null,
      })),
    };
    const result = Report.safeParse(singleVariant);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personas[0]?.score_b).toBeNull();
    }
  });

  it('rejects a persona with score_a out of [0,10]', () => {
    const badPersona = { ...fixtureRaw.personas[0], score_a: 11 };
    const bad = {
      ...fixtureRaw,
      personas: [badPersona, ...fixtureRaw.personas.slice(1)],
    };
    expect(Report.safeParse(bad).success).toBe(false);
  });
});
