/**
 * /pricing — public pack-selection page (issue #144).
 *
 * Three one-time credit packs. Optimises for contact/paid conversion;
 * no "start free" CTA, no email capture, no subscription language
 * (per pricing_conversion_goal project feedback).
 *
 * Visit-estimate formula: Math.floor(cents / 3.5)
 * Issue #112 manager decision: use 3.5¢/visit average cost, not the 5¢
 * ceiling used in BuyCredits (which shows conservative estimates for
 * existing customers). The public pricing page shows the more compelling
 * avg-cost figure to optimise for conversion.
 *
 * Auth-aware CTA: server reads session cookie; authenticated users see the
 * BuyButton (direct Stripe checkout); unauthenticated get sign-in redirect.
 */

// React Server Component — no 'use client' directive.

import { cookies } from 'next/headers';
import { PricingCta } from './PricingCta';

interface Pack {
  id: 'starter' | 'growth' | 'scale';
  label: string;
  usd: number;
  credits: number;
  /** Estimated visits at 3.5¢/visit avg (#112). */
  visitEstimate: number;
}

// Issue #112: visit estimate = Math.floor((usd * 100) / 3.5)
//   Starter:  Math.floor(2900 / 3.5) = 828
//   Growth:   Math.floor(9900 / 3.5) = 2828
//   Scale:    Math.floor(29900 / 3.5) = 8542
const PACKS: Pack[] = [
  {
    id: 'starter',
    label: 'Starter',
    usd: 29,
    credits: 1_000,
    visitEstimate: Math.floor(2900 / 3.5),
  },
  {
    id: 'growth',
    label: 'Growth',
    usd: 99,
    credits: 4_000,
    visitEstimate: Math.floor(9900 / 3.5),
  },
  {
    id: 'scale',
    label: 'Scale',
    usd: 299,
    credits: 15_000,
    visitEstimate: Math.floor(29900 / 3.5),
  },
];

export const __test__ = { PACKS };

export default async function PricingPage() {
  const jar = await cookies();
  const isAuthenticated =
    jar.has('__Host-wb_session') || jar.has('wb_session');

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-center">
        Synthetic buyer panels — know if visitors will buy before you launch.
      </h1>

      {/* Pack tiles — 3-column grid on md+, stacked on mobile */}
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
        {PACKS.map((pack) => (
          <div
            key={pack.id}
            className="flex flex-col rounded-xl border border-gray-200 bg-white px-6 py-8 shadow-sm"
          >
            <span className="text-lg font-semibold text-gray-900">
              {pack.label}
            </span>

            <span className="mt-2 text-4xl font-bold text-gray-900">
              ${pack.usd}
            </span>

            <span
              className="mt-3 text-sm text-gray-600"
              title="avg 3.5¢/visit; ceiling 5¢"
            >
              {pack.credits.toLocaleString()} credits (~{pack.visitEstimate.toLocaleString()} visits)
            </span>

            {/* Sample report link above buy button */}
            <a
              href="/r/test-fixture"
              className="mt-6 text-sm text-blue-600 hover:underline"
            >
              See a sample report →
            </a>

            <PricingCta
              packId={pack.id}
              label={pack.label}
              usd={pack.usd}
              isAuthenticated={isAuthenticated}
            />
          </div>
        ))}
      </div>

      {/* Secondary sign-in link for users who already have credits */}
      <p className="mt-10 text-center text-sm text-gray-600">
        Already have credits?{' '}
        <a href="/sign-in" className="text-blue-600 hover:underline">
          Sign in →
        </a>
      </p>
    </main>
  );
}
