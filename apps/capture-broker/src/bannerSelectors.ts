import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Loads `configs/banner-selectors.yaml` from the repo root. Spec §5.9
 * pins this location and §2 #2 says capture-worker DOM-removes (never
 * clicks) — this loader is the broker's view of the same list, which it
 * forwards to the worker on bootstrap.
 */
export type BannerSelectorList = readonly string[];

export const REPO_BANNER_SELECTORS_PATH = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
  'configs/banner-selectors.yaml',
);

type BannerSelectorsFile = { selectors?: unknown };

export function loadBannerSelectors(path = REPO_BANNER_SELECTORS_PATH): BannerSelectorList {
  const text = readFileSync(path, 'utf8');
  const parsed = parseYaml(text) as BannerSelectorsFile | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`banner-selectors.yaml: expected object, got ${typeof parsed}`);
  }
  const list = parsed.selectors;
  if (!Array.isArray(list) || list.some((s) => typeof s !== 'string')) {
    throw new Error('banner-selectors.yaml: `selectors` must be a list of strings');
  }
  return Object.freeze([...(list as string[])]);
}
