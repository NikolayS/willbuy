/**
 * report-theme-role-constants.test.ts — spec-pins for ThemeBoard + PersonaGrid.
 *
 * CATEGORIES (ThemeBoard, spec §5.18 #6):
 *   4 keys: blockers, objections, confusions, questions.
 *   Keys must match CLUSTER_TO_THEME values in aggregator/main.py:
 *   {"unanswered_blockers": "blockers", "objections": "objections",
 *    "confusions": "confusions", "questions": "questions"}.
 *   Adding a 5th category without updating the aggregator would render empty.
 *
 * ROLE_LABEL (PersonaGrid, spec §5.18 #7):
 *   2 entries matching RoleArchetype in shared/src/backstory.ts.
 *   'founder_or_eng_lead' and 'ic_engineer'.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as themeBoardTest } from '../components/report/ThemeBoard';
import { __test__ as personaGridTest } from '../components/report/PersonaGrid';

const { CATEGORIES } = themeBoardTest;
const { ROLE_LABEL } = personaGridTest;

// ── CATEGORIES (spec §5.18 #6) ────────────────────────────────────────────────

describe('CATEGORIES spec-pin (spec §5.18 #6)', () => {
  it('has exactly 4 theme categories', () => {
    expect(CATEGORIES).toHaveLength(4);
  });

  it('contains the exact 4 keys matching CLUSTER_TO_THEME values in aggregator/main.py', () => {
    const keys = CATEGORIES.map((c) => c.key);
    expect(new Set(keys)).toEqual(new Set(['blockers', 'objections', 'confusions', 'questions']));
  });

  it('has a non-empty label for every category', () => {
    for (const c of CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('blockers category has label "Blockers"', () => {
    const blockers = CATEGORIES.find((c) => c.key === 'blockers');
    expect(blockers?.label).toBe('Blockers');
  });
});

// ── ROLE_LABEL (spec §5.18 #7) ────────────────────────────────────────────────

describe('ROLE_LABEL spec-pin (spec §5.18 #7)', () => {
  it('has exactly 2 role labels matching RoleArchetype in shared/src/backstory.ts', () => {
    const keys = Object.keys(ROLE_LABEL);
    expect(new Set(keys)).toEqual(new Set(['founder_or_eng_lead', 'ic_engineer']));
  });

  it('founder_or_eng_lead → "founder / eng lead"', () => {
    expect(ROLE_LABEL['founder_or_eng_lead']).toBe('founder / eng lead');
  });

  it('ic_engineer → "IC engineer"', () => {
    expect(ROLE_LABEL['ic_engineer']).toBe('IC engineer');
  });
});
