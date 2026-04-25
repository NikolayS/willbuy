import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureUrl } from '../src/capture.js';
import type { A11yNode, CaptureResult } from '../src/types.js';
import { startFixtureServer, type FixtureServer } from './server/fixtureServer.js';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(here, 'fixtures', 'simple.golden.json');

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

/**
 * Stable serializer: drops the volatile `url` field (test-server port
 * varies) and any node `name` on roles that include the URL itself. We
 * keep the structural shape — role hierarchy, accessible names, image
 * alts, button labels, heading levels — which is what the golden
 * captures.
 */
function stableShape(result: CaptureResult): unknown {
  const stripUrls = (n: A11yNode): unknown => {
    const { role, name, level, value, description, children } = n;
    const out: Record<string, unknown> = { role, name };
    if (level !== undefined) out.level = level;
    if (value !== undefined) out.value = value;
    if (description !== undefined) out.description = description;
    out.children = children.map(stripUrls);
    return out;
  };
  return {
    status: result.status,
    a11y_tree: result.a11y_tree.map(stripUrls),
    banner_selectors_matched: result.banner_selectors_matched,
  };
}

describe('captureUrl(simple.html) — golden a11y-tree match (spec §2 #2)', () => {
  it('returns status=ok with the expected accessibility tree shape', async () => {
    const result = await captureUrl(server.url('/simple.html'));

    expect(result.status).toBe('ok');
    expect(result.url).toBe(server.url('/simple.html'));
    expect(result.banner_selectors_matched).toEqual([]);
    expect(result.host_count).toBeGreaterThanOrEqual(1);
    expect(result.breach_reason).toBeUndefined();

    // Sanity: the tree must surface the heading + image alt + button +
    // link textually, regardless of how Chromium happens to nest roles.
    const flat = JSON.stringify(result.a11y_tree);
    expect(flat).toMatch(/Pricing that scales with you/);
    expect(flat).toMatch(/Postgres logo/);
    expect(flat).toMatch(/Start free/);
    expect(flat).toMatch(/Talk to sales/);

    const actualShape = stableShape(result);

    if (process.env.UPDATE_GOLDEN === '1') {
      await writeFile(GOLDEN_PATH, JSON.stringify(actualShape, null, 2) + '\n');
    }

    const goldenRaw = await readFile(GOLDEN_PATH, 'utf8');
    const golden = JSON.parse(goldenRaw);
    expect(actualShape).toEqual(golden);
  });
});
