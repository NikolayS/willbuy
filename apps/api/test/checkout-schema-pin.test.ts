/**
 * checkout-schema-pin.test.ts — spec-pin for CreateSessionBodySchema
 * (spec §5.6, issue #36). No DB / Stripe API required.
 *
 * The existing stripe.test.ts verifies the schema via HTTP roundtrip
 * (Docker-gated). This file pins the schema directly.
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/routes/checkout.js';

const { CreateSessionBodySchema } = __test__;

describe('CreateSessionBodySchema — pack_id enum (spec §5.6)', () => {
  it('accepts "starter"', () => {
    expect(CreateSessionBodySchema.safeParse({ pack_id: 'starter' }).success).toBe(true);
  });

  it('accepts "growth"', () => {
    expect(CreateSessionBodySchema.safeParse({ pack_id: 'growth' }).success).toBe(true);
  });

  it('accepts "scale"', () => {
    expect(CreateSessionBodySchema.safeParse({ pack_id: 'scale' }).success).toBe(true);
  });

  it('rejects unknown pack_id', () => {
    expect(CreateSessionBodySchema.safeParse({ pack_id: 'enterprise' }).success).toBe(false);
    expect(CreateSessionBodySchema.safeParse({ pack_id: 'free' }).success).toBe(false);
  });

  it('rejects missing pack_id', () => {
    expect(CreateSessionBodySchema.safeParse({}).success).toBe(false);
  });

  it('has exactly 3 valid pack_id values', () => {
    expect(CreateSessionBodySchema.shape.pack_id.options).toHaveLength(3);
  });
});
