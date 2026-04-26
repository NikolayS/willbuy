/**
 * landing.test.tsx — TDD acceptance for issue #145.
 *
 * Asserts the / landing page renders:
 *  - "See pricing" link pointing to /pricing (primary CTA)
 *  - "See a sample report" link pointing to /r/test-fixture (secondary CTA)
 *  - "Sign in" link pointing to /sign-in (tertiary, text-only — NOT a button)
 *  - "Read the spec" link still present (demoted to footer)
 *  - No "start free" copy anywhere (paid-conversion — pricing_conversion_goal)
 *
 * Spec refs: docs/launch/pricing-cta-audit.md §3a, SPEC §1 positioning.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from '../app/page';

describe('/ landing page CTAs (issue #145)', () => {
  function getHtml(): string {
    return renderToStaticMarkup(<LandingPage />);
  }

  it('primary CTA: "See pricing" link points to /pricing', () => {
    const html = getHtml();
    expect(html).toMatch(/see pricing/i);
    expect(html).toMatch(/href="\/pricing"/i);
  });

  it('secondary CTA: "See a sample report" link points to /r/test-fixture', () => {
    const html = getHtml();
    expect(html).toMatch(/see a sample report/i);
    expect(html).toMatch(/href="\/r\/test-fixture"/i);
  });

  it('tertiary CTA: "Sign in" link points to /sign-in', () => {
    const html = getHtml();
    expect(html).toMatch(/sign in/i);
    expect(html).toMatch(/href="\/sign-in"/i);
  });

  it('footer: "Read the spec" link is still present', () => {
    const html = getHtml();
    expect(html).toMatch(/read the.*spec/i);
  });

  it('contains no "start free" copy (paid-conversion page)', () => {
    expect(getHtml()).not.toMatch(/start free/i);
  });
});
