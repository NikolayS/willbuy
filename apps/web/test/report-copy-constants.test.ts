/**
 * report-copy-constants.test.ts — spec-pins for CATEGORIES (ThemeBoard),
 * ROLE_LABEL (PersonaGrid), and VERDICT_COPY (HeadlineDelta).
 *
 * CATEGORIES (ThemeBoard.tsx):
 *   4 theme categories rendered as chart sections in the theme board. The
 *   keys must match CLUSTER_TO_THEME values in the Python aggregator (blockers,
 *   objections, confusions, questions). A key mismatch causes the React
 *   theme_board[category] lookup to return undefined, rendering an empty chart.
 *
 * ROLE_LABEL (PersonaGrid.tsx):
 *   2 entries covering the RoleArchetype values that reach the report. Changing
 *   'founder_or_eng_lead' → 'founder' would render 'undefined' for that role
 *   in the persona grid. Must cover every role in shared/src/backstory.ts
 *   that isn't coerced by the aggregator (the two surviving roles).
 *
 * VERDICT_COPY (HeadlineDelta.tsx):
 *   3 user-facing verdict sentences for better/worse/inconclusive. A typo or
 *   rename (e.g. 'better' → 'win') causes the verdict sentence to render
 *   'undefined' silently. The sentence copy is what users read as the top-line
 *   result of their study.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as themeBoardTest } from '../components/report/ThemeBoard';
import { __test__ as personaGridTest } from '../components/report/PersonaGrid';
import { __test__ as headlineDeltaTest } from '../components/report/HeadlineDelta';

const { CATEGORIES } = themeBoardTest;
const { ROLE_LABEL } = personaGridTest;
const { VERDICT_COPY } = headlineDeltaTest;

describe('CATEGORIES spec-pin (ThemeBoard — must match aggregator CLUSTER_TO_THEME values)', () => {
  it('has exactly 4 entries', () => {
    expect(CATEGORIES).toHaveLength(4);
  });

  it('has a "blockers" entry', () => {
    expect(CATEGORIES.some((c) => c.key === 'blockers')).toBe(true);
  });

  it('has an "objections" entry', () => {
    expect(CATEGORIES.some((c) => c.key === 'objections')).toBe(true);
  });

  it('has a "confusions" entry', () => {
    expect(CATEGORIES.some((c) => c.key === 'confusions')).toBe(true);
  });

  it('has a "questions" entry', () => {
    expect(CATEGORIES.some((c) => c.key === 'questions')).toBe(true);
  });

  it('every entry has a non-empty label', () => {
    for (const c of CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('"blockers" → "Blockers" (display label)', () => {
    const c = CATEGORIES.find((x) => x.key === 'blockers');
    expect(c!.label).toBe('Blockers');
  });
});

describe('ROLE_LABEL spec-pin (PersonaGrid — RoleArchetype display labels)', () => {
  it('has exactly 2 entries', () => {
    expect(Object.keys(ROLE_LABEL)).toHaveLength(2);
  });

  it('"founder_or_eng_lead" → "founder / eng lead"', () => {
    expect(ROLE_LABEL['founder_or_eng_lead']).toBe('founder / eng lead');
  });

  it('"ic_engineer" → "IC engineer"', () => {
    expect(ROLE_LABEL['ic_engineer']).toBe('IC engineer');
  });
});

describe('VERDICT_COPY spec-pin (HeadlineDelta — user-facing verdict sentences)', () => {
  it('has exactly 3 entries', () => {
    expect(Object.keys(VERDICT_COPY)).toHaveLength(3);
  });

  it('"better" → "NEW converts better."', () => {
    expect(VERDICT_COPY['better']).toBe('NEW converts better.');
  });

  it('"worse" → "NEW converts worse."', () => {
    expect(VERDICT_COPY['worse']).toBe('NEW converts worse.');
  });

  it('"inconclusive" → "Inconclusive — no clear winner."', () => {
    expect(VERDICT_COPY['inconclusive']).toBe('Inconclusive — no clear winner.');
  });

  it('all three sentences end with a period', () => {
    for (const [, sentence] of Object.entries(VERDICT_COPY)) {
      expect(sentence.endsWith('.')).toBe(true);
    }
  });
});
