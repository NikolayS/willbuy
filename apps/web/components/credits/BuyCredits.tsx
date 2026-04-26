'use client';

/**
 * BuyCredits — credit-pack selection + Stripe Checkout redirect.
 *
 * Spec §5.6: starter=$29/2900¢, growth=$99/9900¢, scale=$299/29900¢.
 * Visit estimate derived from pack.cents / 3.5 (issue #112 manager decision:
 * use 3.5¢/visit average cost, not the 5¢ ceiling, for consistency with
 * the public /pricing page).
 * POSTs to /checkout/sessions with the selected pack_id.
 * Redirects to the Stripe Checkout URL returned by the API.
 *
 * Issue #36. Fix #73: correct visit-estimate derivation. Fix #144: align
 * visit-estimate formula with /pricing page (3.5¢ avg per #112).
 */

import { useState } from 'react';

type PackId = 'starter' | 'growth' | 'scale';

interface Pack {
  id: PackId;
  label: string;
  usd: number;
  /** Pack price in USD cents; visit estimate = Math.floor(cents / 3.5) (#112). */
  cents: number;
  credits: number;
}

/**
 * Derive visit-estimate description from pack cents.
 * Issue #112 manager decision: use 3.5¢/visit average (not 5¢ ceiling)
 * so estimates are consistent with the public /pricing page.
 *   Starter:  Math.floor(2900 / 3.5) = 828 visits
 *   Growth:   Math.floor(9900 / 3.5) = 2828 visits
 *   Scale:    Math.floor(29900 / 3.5) = 8542 visits
 */
function visitEstimate(cents: number): string {
  const visits = Math.floor(cents / 3.5);
  return `≈ ${visits.toLocaleString()} visits`;
}

const PACKS: Pack[] = [
  {
    id: 'starter',
    label: 'Starter',
    usd: 29,
    cents: 2900,
    credits: 1000,
  },
  {
    id: 'growth',
    label: 'Growth',
    usd: 99,
    cents: 9900,
    credits: 4000,
  },
  {
    id: 'scale',
    label: 'Scale',
    usd: 299,
    cents: 29900,
    credits: 15000,
  },
];

interface BuyCreditsProps {
  /** API key for the Authorization: Bearer header. */
  apiKey: string;
  /** Base URL of the API (e.g. https://api.willbuy.dev). No trailing slash. */
  apiBaseUrl: string;
}

export function BuyCredits({ apiKey, apiBaseUrl }: BuyCreditsProps) {
  const [selected, setSelected] = useState<PackId>('starter');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ pack_id: selected }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Unexpected error (${res.status})`);
        return;
      }
      const data = (await res.json()) as { url: string };
      // Redirect to Stripe Checkout.
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Buy credits</h2>
      <div className="flex gap-3 flex-wrap">
        {PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => setSelected(pack.id)}
            className={[
              'flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors',
              selected === pack.id
                ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                : 'border-gray-200 hover:border-gray-400',
            ].join(' ')}
          >
            <span className="font-medium">{pack.label}</span>
            <span className="text-2xl font-bold">${pack.usd}</span>
            <span className="text-sm text-gray-600">
              {pack.credits.toLocaleString()} credits
            </span>
            <span className="text-xs text-gray-500">{visitEstimate(pack.cents)}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <button
        type="button"
        onClick={() => { void handleBuy(); }}
        disabled={loading}
        className="self-start rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Redirecting…' : 'Buy credits'}
      </button>
    </div>
  );
}
