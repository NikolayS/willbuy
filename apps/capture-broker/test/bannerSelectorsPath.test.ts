/**
 * bannerSelectorsPath.test.ts — spec-pin for the REPO_BANNER_SELECTORS_PATH
 * constant and the loadBannerSelectors() format contract.
 *
 * The existing bannerSelectors.test.ts verifies that loadBannerSelectors()
 * returns a non-empty list containing certain selectors, but never pins:
 *  - That the path ends in 'configs/banner-selectors.yaml' (so a file rename
 *    breaks the broker's ability to forward the correct list to the worker)
 *  - That the returned list is frozen (readonly — callers cannot mutate it)
 *  - That the list elements are strings
 *
 * Spec refs:
 *   §5.9 — banner selector list location pinned in configs/banner-selectors.yaml
 *   §2 #2 — capture-worker DOM-removes banner elements using this list.
 */

import { describe, it, expect } from 'vitest';
import { REPO_BANNER_SELECTORS_PATH, loadBannerSelectors } from '../src/bannerSelectors.js';

describe('REPO_BANNER_SELECTORS_PATH (spec §5.9)', () => {
  it('points to configs/banner-selectors.yaml', () => {
    expect(REPO_BANNER_SELECTORS_PATH).toMatch(/configs[\\/]banner-selectors\.yaml$/);
  });
});

describe('loadBannerSelectors() output format (spec §2 #2, §5.9)', () => {
  it('returns an array (BannerSelectorList)', () => {
    const list = loadBannerSelectors();
    expect(Array.isArray(list)).toBe(true);
  });

  it('all elements are non-empty strings', () => {
    const list = loadBannerSelectors();
    for (const s of list) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('list is frozen (readonly — elements cannot be pushed)', () => {
    const list = loadBannerSelectors();
    // readonly array: Object.isFrozen should be true
    expect(Object.isFrozen(list)).toBe(true);
  });
});
