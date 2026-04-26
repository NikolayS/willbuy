/**
 * pricing.test.tsx — TDD acceptance for issue #144.
 *
 * Asserts the /pricing page renders:
 *  - All three pack names: Starter, Growth, Scale
 *  - All three USD amounts: $29, $99, $299
 *  - No "start free" copy (paid-conversion page — per pricing_conversion_goal feedback)
 *  - "Already have credits? Sign in" link
 *  - "See a sample report" link pointing to /r/test-fixture
 *
 * Visit estimates use 3.5¢/visit avg (issue #112 manager decision).
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PricingPage from '../app/pricing/page';

describe('/pricing page (issue #144)', () => {
  function getHtml(): string {
    return renderToStaticMarkup(<PricingPage />);
  }

  it('renders pack name "Starter"', () => {
    expect(getHtml()).toMatch(/Starter/i);
  });

  it('renders pack name "Growth"', () => {
    expect(getHtml()).toMatch(/Growth/i);
  });

  it('renders pack name "Scale"', () => {
    expect(getHtml()).toMatch(/Scale/i);
  });

  it('renders Starter price "$29"', () => {
    expect(getHtml()).toMatch(/\$29/);
  });

  it('renders Growth price "$99"', () => {
    expect(getHtml()).toMatch(/\$99/);
  });

  it('renders Scale price "$299"', () => {
    expect(getHtml()).toMatch(/\$299/);
  });

  it('contains no "start free" copy (paid-conversion page)', () => {
    expect(getHtml()).not.toMatch(/start free/i);
  });

  it('renders "Already have credits? Sign in" link', () => {
    expect(getHtml()).toMatch(/already have credits/i);
  });

  it('"See a sample report" link points to /r/test-fixture', () => {
    const html = getHtml();
    expect(html).toMatch(/see a sample report/i);
    expect(html).toMatch(/href="\/r\/test-fixture"/i);
  });
});
