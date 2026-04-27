import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';

describe('@willbuy/shared barrel export', () => {
  it('exports visitor-output types: VisitorOutput', () => {
    expect(shared.VisitorOutput).toBeDefined();
    expect(typeof shared.VisitorOutput.parse).toBe('function');
  });

  it('exports scoring: NextAction, NEXT_ACTION_WEIGHTS, PAID_TIERS, scoreVisit', () => {
    expect(shared.NextAction).toBeDefined();
    expect(shared.NEXT_ACTION_WEIGHTS).toBeDefined();
    expect(shared.PAID_TIERS).toBeDefined();
    expect(typeof shared.scoreVisit).toBe('function');
  });

  it('exports report: Report schema', () => {
    expect(shared.Report).toBeDefined();
    expect(typeof shared.Report.parse).toBe('function');
  });

  it('exports backstory: Backstory and sub-schemas', () => {
    expect(shared.Backstory).toBeDefined();
    expect(shared.Stage).toBeDefined();
    expect(shared.RoleArchetype).toBeDefined();
    expect(shared.BudgetAuthority).toBeDefined();
  });
});
