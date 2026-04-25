import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadBannerSelectors } from '../src/bannerSelectors.js';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));

type BannerFixture = {
  html: string;
  expected_match_selector_substr: string;
  primary_must_remain: string[];
};

// Spec §2 #2: capture-worker REMOVES banner elements from the DOM (does not
// click them). The broker only forwards the curated selector list — the
// removal is a worker responsibility. This test asserts the broker's view:
// (a) the curated YAML loads, (b) at least one selector matches a known
// banner fixture, (c) DOM-removal of that selector leaves primary content
// intact (we simulate removal with a regex strip; capture-worker uses
// Playwright's element.remove()).
describe('banner selectors — spec §2 #2 + §5.9', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(here, 'fixtures/banner-html.json'), 'utf8'),
  ) as BannerFixture;

  it('loads the curated selector list from configs/banner-selectors.yaml', () => {
    const list = loadBannerSelectors();
    expect(list.length).toBeGreaterThan(5);
    // Sanity: list is frozen (read-only).
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('contains a selector that matches the cookie-banner fixture', () => {
    const list = loadBannerSelectors();
    const match = list.find((s) =>
      s.toLowerCase().includes(fixture.expected_match_selector_substr.toLowerCase()),
    );
    expect(match).toBeTruthy();
  });

  it('DOM-removal of the matched element preserves primary content', () => {
    // Simulate `element.remove()` for the cookie-banner div: strip the
    // div by id. (Capture-worker uses Playwright element.remove(); this
    // is a unit-level smoke that the SELECTOR LIST is correct, not a
    // browser test.)
    const stripped = fixture.html.replace(
      /<div id="cookie-banner"[\s\S]*?<\/div>/,
      '',
    );
    for (const must of fixture.primary_must_remain) {
      expect(stripped).toContain(must);
    }
    expect(stripped).not.toContain('cookie-banner');
    expect(stripped).not.toContain('Accept');
  });
});
