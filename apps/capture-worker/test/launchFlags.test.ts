import { describe, it, expect } from 'vitest';
import { LAUNCH_FLAGS } from '../src/launchFlags.js';

describe('LAUNCH_FLAGS (spec §2 #2 — Chromium sandbox enabled)', () => {
  it('has exactly 14 entries (prevents silent flag additions)', () => {
    expect(LAUNCH_FLAGS).toHaveLength(14);
  });

  it('all flags start with "--" (no typos or bare values)', () => {
    for (const flag of LAUNCH_FLAGS) {
      expect(flag.startsWith('--')).toBe(true);
    }
  });

  it('does not contain the banned sandbox-disabling flag', () => {
    // The CI lint (`willbuy/no-sandbox-flag`) catches a raw literal in
    // source. This test catches a runtime composition (template-literal
    // concat, env interpolation, etc.) that the lint can't see.
    const banned = ['-', '-', 'no-sandbox'].join('');
    for (const flag of LAUNCH_FLAGS) {
      expect(flag).not.toContain(banned);
    }
  });

  it('explicitly enables headless=new (modern renderer code path)', () => {
    expect(LAUNCH_FLAGS).toContain('--headless=new');
  });

  it('explicitly disables /dev/shm so tmpfs sizing in the container works', () => {
    expect(LAUNCH_FLAGS).toContain('--disable-dev-shm-usage');
  });

  it('uses a deterministic 1280x800 window for golden a11y-tree stability', () => {
    expect(LAUNCH_FLAGS).toContain('--window-size=1280,800');
  });
});
