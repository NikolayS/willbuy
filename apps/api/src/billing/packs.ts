/**
 * billing/packs.ts — credit-pack tier definitions (spec §5.6).
 *
 * Pack mapping: starter=$29=1000c, growth=$99=4000c, scale=$299=15000c.
 * price_id values are injected from env at server startup via initPacks().
 *
 * Spec refs: §5.6 (cost model + pack tiers).
 */

export type PackId = 'starter' | 'growth' | 'scale';

export interface Pack {
  /** Stripe Price ID (test-mode). Set from env via initPacks(). */
  price_id: string;
  /** Pack price in USD cents. */
  cents: number;
  /** Pack price in USD (integer dollars). */
  usd: number;
  /** Number of credits (each credit ≈ 1/3.5¢ of LLM spend). */
  credits: number;
}

// Module-level singleton. Populated by initPacks() before routes are wired.
let _packs: Record<PackId, Pack> | null = null;

/**
 * Initialize PACKS from env. Must be called before PACKS is accessed.
 * Idempotent — safe to call multiple times (last call wins, but server.ts
 * only calls it once per process).
 */
export function initPacks(opts: {
  starterPriceId: string;
  growthPriceId: string;
  scalePriceId: string;
}): void {
  _packs = {
    starter: {
      price_id: opts.starterPriceId,
      cents: 2900,
      usd: 29,
      credits: 1000,
    },
    growth: {
      price_id: opts.growthPriceId,
      cents: 9900,
      usd: 99,
      credits: 4000,
    },
    scale: {
      price_id: opts.scalePriceId,
      cents: 29900,
      usd: 299,
      credits: 15000,
    },
  };
}

/**
 * Typed lookup for all credit-pack tiers.
 * Accessing before initPacks() throws — callers in routes/ always run after
 * server.ts calls initPacks() in buildServer().
 */
export const PACKS: Record<PackId, Pack> = new Proxy({} as Record<PackId, Pack>, {
  get(_target, prop: string) {
    if (!_packs) {
      throw new Error('PACKS accessed before initPacks() — call initPacks() in buildServer()');
    }
    return _packs[prop as PackId];
  },
  ownKeys() {
    return ['starter', 'growth', 'scale'];
  },
  has(_target, prop: string) {
    return ['starter', 'growth', 'scale'].includes(prop);
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    if (['starter', 'growth', 'scale'].includes(prop)) {
      return { enumerable: true, configurable: true };
    }
    return undefined;
  },
});
