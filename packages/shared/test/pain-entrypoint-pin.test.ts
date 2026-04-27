/**
 * pain-entrypoint-pin.test.ts — spec-pins for CurrentPain and EntryPoint
 * Zod enums in packages/shared/src/backstory.ts (spec §2 #5).
 *
 * CurrentPain (6 entries): the triggering event that drove the persona to
 * evaluate postgres.ai. Renaming any value (e.g. 'cost_creep' → 'cost_issue')
 * silently breaks parsing for backstories with that pain value.
 *
 * EntryPoint (6 entries): how the persona found postgres.ai. Renaming
 * 'postgres_blog_footer' would break any backstory using that entry point.
 * The long-form values (conference_booth_followup, postgres_blog_footer) are
 * especially prone to typo drift.
 */

import { describe, expect, it } from 'vitest';
import { CurrentPain, EntryPoint } from '../src/backstory.js';

describe('CurrentPain enum spec-pin (spec §2 #5)', () => {
  it('has exactly 6 options', () => {
    expect(CurrentPain.options).toHaveLength(6);
  });

  it('accepts "recent_outage"', () => {
    expect(() => CurrentPain.parse('recent_outage')).not.toThrow();
  });

  it('accepts "slow_queries"', () => {
    expect(() => CurrentPain.parse('slow_queries')).not.toThrow();
  });

  it('accepts "bad_migration_fear"', () => {
    expect(() => CurrentPain.parse('bad_migration_fear')).not.toThrow();
  });

  it('accepts "cost_creep"', () => {
    expect(() => CurrentPain.parse('cost_creep')).not.toThrow();
  });

  it('accepts "upcoming_scale_event"', () => {
    expect(() => CurrentPain.parse('upcoming_scale_event')).not.toThrow();
  });

  it('accepts "post_mortem_in_hand"', () => {
    expect(() => CurrentPain.parse('post_mortem_in_hand')).not.toThrow();
  });

  it('rejects "cost_issue" (plausible rename of cost_creep)', () => {
    expect(() => CurrentPain.parse('cost_issue')).toThrow();
  });

  it('rejects "outage" (truncated form of recent_outage)', () => {
    expect(() => CurrentPain.parse('outage')).toThrow();
  });
});

describe('EntryPoint enum spec-pin (spec §2 #5)', () => {
  it('has exactly 6 options', () => {
    expect(EntryPoint.options).toHaveLength(6);
  });

  it('accepts "hacker_news"', () => {
    expect(() => EntryPoint.parse('hacker_news')).not.toThrow();
  });

  it('accepts "newsletter"', () => {
    expect(() => EntryPoint.parse('newsletter')).not.toThrow();
  });

  it('accepts "vc_referral"', () => {
    expect(() => EntryPoint.parse('vc_referral')).not.toThrow();
  });

  it('accepts "google_search"', () => {
    expect(() => EntryPoint.parse('google_search')).not.toThrow();
  });

  it('accepts "postgres_blog_footer"', () => {
    expect(() => EntryPoint.parse('postgres_blog_footer')).not.toThrow();
  });

  it('accepts "conference_booth_followup"', () => {
    expect(() => EntryPoint.parse('conference_booth_followup')).not.toThrow();
  });

  it('rejects "blog_footer" (truncated form)', () => {
    expect(() => EntryPoint.parse('blog_footer')).toThrow();
  });

  it('rejects "linkedin" (plausible addition)', () => {
    expect(() => EntryPoint.parse('linkedin')).toThrow();
  });
});
