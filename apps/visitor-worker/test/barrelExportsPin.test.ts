/**
 * barrelExportsPin.test.ts — pin all public barrel exports from
 * @willbuy/visitor-worker (src/index.ts).
 *
 * The existing skeleton.test.ts only checks `runVisit`. This file
 * asserts every public export so a barrel re-export removal fails CI.
 */

import { describe, it, expect } from 'vitest';
import * as vw from '../src/index.js';

describe('@willbuy/visitor-worker barrel exports', () => {
  it('exports runVisit as a function', () => {
    expect(typeof vw.runVisit).toBe('function');
  });

  it('exports computeLogicalRequestKey as a function', () => {
    expect(typeof vw.computeLogicalRequestKey).toBe('function');
  });

  it('exports pollVisitorOnce as a function', () => {
    expect(typeof vw.pollVisitorOnce).toBe('function');
  });

  it('exports runVisitorPollingLoop as a function', () => {
    expect(typeof vw.runVisitorPollingLoop).toBe('function');
  });
});
