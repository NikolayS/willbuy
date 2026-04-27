/**
 * barrelExportsPin.test.ts — pin that all intended public exports from
 * @willbuy/shared are accessible from the barrel (src/index.ts).
 *
 * The existing index.test.ts only checks 6 of the ~20 exports.
 * This file asserts every schema, type alias, and helper that downstream
 * packages (apps/api, apps/visitor-worker, apps/aggregator) import from
 * @willbuy/shared so a barrel re-export removal fails CI immediately.
 */

import { describe, it, expect } from 'vitest';
import * as shared from '../src/index.js';

describe('@willbuy/shared barrel exports — complete pin', () => {
  describe('visitor module', () => {
    it('exports VisitorOutput', () => expect(shared.VisitorOutput).toBeDefined());
  });

  describe('scoring module', () => {
    it('exports NextAction', () => expect(shared.NextAction).toBeDefined());
    it('exports NEXT_ACTION_WEIGHTS', () => expect(shared.NEXT_ACTION_WEIGHTS).toBeDefined());
    it('exports PAID_TIERS', () => expect(shared.PAID_TIERS).toBeDefined());
    it('exports scoreVisit', () => expect(typeof shared.scoreVisit).toBe('function'));
  });

  describe('report module', () => {
    it('exports Report', () => expect(shared.Report).toBeDefined());
  });

  describe('backstory module', () => {
    it('exports Backstory', () => expect(shared.Backstory).toBeDefined());
    it('exports Stage', () => expect(shared.Stage).toBeDefined());
    it('exports TeamSize', () => expect(shared.TeamSize).toBeDefined());
    it('exports ManagedPostgres', () => expect(shared.ManagedPostgres).toBeDefined());
    it('exports CurrentPain', () => expect(shared.CurrentPain).toBeDefined());
    it('exports EntryPoint', () => expect(shared.EntryPoint).toBeDefined());
    it('exports Regulated', () => expect(shared.Regulated).toBeDefined());
    it('exports PostgresDepth', () => expect(shared.PostgresDepth).toBeDefined());
    it('exports BudgetAuthority', () => expect(shared.BudgetAuthority).toBeDefined());
    it('exports RoleArchetype', () => expect(shared.RoleArchetype).toBeDefined());
  });
});
