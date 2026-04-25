import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';

describe('@willbuy/shared barrel export', () => {
  it('exports VisitorOutput, Backstory, NextAction, NEXT_ACTION_WEIGHTS, PAID_TIERS, scoreVisit', () => {
    expect(shared.VisitorOutput).toBeDefined();
    expect(shared.Backstory).toBeDefined();
    expect(shared.NextAction).toBeDefined();
    expect(shared.NEXT_ACTION_WEIGHTS).toBeDefined();
    expect(shared.PAID_TIERS).toBeDefined();
    expect(shared.scoreVisit).toBeDefined();
  });
});
