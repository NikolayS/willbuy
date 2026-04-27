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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PricingPage from '../app/pricing/page';

// Mock next/headers so cookies() works outside a request scope in unit tests.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    has: () => false,
  }),
}));

describe('/pricing page (issue #144)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHtml(): Promise<string> {
    const el = await PricingPage();
    return renderToStaticMarkup(el);
  }

  it('renders pack name "Starter"', async () => {
    expect(await getHtml()).toMatch(/Starter/i);
  });

  it('renders pack name "Growth"', async () => {
    expect(await getHtml()).toMatch(/Growth/i);
  });

  it('renders pack name "Scale"', async () => {
    expect(await getHtml()).toMatch(/Scale/i);
  });

  it('renders Starter price "$29"', async () => {
    expect(await getHtml()).toMatch(/\$29/);
  });

  it('renders Growth price "$99"', async () => {
    expect(await getHtml()).toMatch(/\$99/);
  });

  it('renders Scale price "$299"', async () => {
    expect(await getHtml()).toMatch(/\$299/);
  });

  it('contains no "start free" copy (paid-conversion page)', async () => {
    expect(await getHtml()).not.toMatch(/start free/i);
  });

  it('renders "Already have credits? Sign in" link', async () => {
    expect(await getHtml()).toMatch(/already have credits/i);
  });

  it('"See a sample report" link points to /r/test-fixture', async () => {
    const html = await getHtml();
    expect(html).toMatch(/see a sample report/i);
    expect(html).toMatch(/href="\/r\/test-fixture"/i);
  });

  it('unauthenticated: shows sign-in redirect link (no session cookie)', async () => {
    const html = await getHtml();
    expect(html).toMatch(/sign-in/i);
  });
});

// ── Visit estimate spec-pins (issue #112 — 3.5¢/visit average) ───────────────
//
// Math.floor(usd_cents / 3.5):
//   Starter: floor(2900 / 3.5) = 828
//   Growth:  floor(9900 / 3.5) = 2828
//   Scale:   floor(29900 / 3.5) = 8542

describe('/pricing visit estimate spec-pins (issue #112)', () => {
  async function getHtml(): Promise<string> {
    const el = await PricingPage();
    return renderToStaticMarkup(el);
  }

  it('Starter shows ~828 visit estimate (Math.floor(2900 / 3.5))', async () => {
    expect(await getHtml()).toMatch(/828\s*visits/i);
  });

  it('Growth shows ~2,828 visit estimate (Math.floor(9900 / 3.5))', async () => {
    expect(await getHtml()).toMatch(/2[,.]?828\s*visits/i);
  });

  it('Scale shows ~8,542 visit estimate (Math.floor(29900 / 3.5))', async () => {
    expect(await getHtml()).toMatch(/8[,.]?542\s*visits/i);
  });
});
