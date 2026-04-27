/**
 * staticPrefixCaps.test.ts — spec-pins for STATIC_PREFIX cap mentions.
 *
 * Spec §2 #15: the static prefix tells the model the exact field caps.
 * These must match the VisitorOutput Zod schema in packages/shared/src/visitor.ts.
 * If the prompt says "≤ 400 chars" but the schema allows 500, the model is
 * given incorrect constraints and validation will silently produce over-cap
 * outputs that fail schema-repair.
 *
 * Tests assert that buildStaticPrefix() mentions each cap from spec §2 #15:
 *   first_impression ≤ 400 chars
 *   list items ≤ 200 chars
 *   reasoning ≤ 1200 chars
 *   will_to_buy / confidence 0..10
 *   next_action enum values (all 8 from amendment A1)
 *   tier fields (none, hobby, express, starter, scale, enterprise)
 */

import { describe, expect, it } from 'vitest';
import { buildStaticPrefix } from '../src/prompt.js';

describe('STATIC_PREFIX cap mentions (spec §2 #15)', () => {
  it('mentions first_impression ≤ 400 chars', () => {
    expect(buildStaticPrefix()).toContain('400');
  });

  it('mentions list items ≤ 200 chars', () => {
    expect(buildStaticPrefix()).toContain('200');
  });

  it('mentions reasoning ≤ 1200 chars', () => {
    expect(buildStaticPrefix()).toContain('1200');
  });

  it('mentions will_to_buy / confidence integer 0..10', () => {
    const prefix = buildStaticPrefix();
    expect(prefix).toContain('will_to_buy');
    expect(prefix).toContain('0..10');
  });

  it('mentions all 8 next_action values (spec §2 #15 / amendment A1)', () => {
    const prefix = buildStaticPrefix();
    const actions = [
      'purchase_paid_today', 'contact_sales', 'book_demo', 'start_paid_trial',
      'bookmark_compare_later', 'start_free_hobby', 'ask_teammate', 'leave',
    ];
    for (const action of actions) {
      expect(prefix).toContain(action);
    }
  });

  it('mentions the 6 tier values for tier_picked_if_buying_today', () => {
    const prefix = buildStaticPrefix();
    for (const tier of ['none', 'hobby', 'express', 'starter', 'scale', 'enterprise']) {
      expect(prefix).toContain(tier);
    }
  });
});
