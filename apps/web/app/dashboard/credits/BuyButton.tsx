'use client';

// BuyButton — initiates Stripe checkout for a credit pack.
// Calls POST /api/checkout/sessions (session-cookie auth) and redirects
// to the Stripe-hosted checkout page on success.

import { useState } from 'react';

interface BuyButtonProps {
  packId: 'starter' | 'growth' | 'scale';
  label: string;
  usd: number;
}

export function BuyButton({ packId, label, usd }: BuyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: packId }),
      });
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (!res.ok) {
        const msg = isJson
          ? ((await res.json()) as { error?: string }).error ?? 'checkout failed'
          : 'payment provider unavailable — please try again';
        setError(msg);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch {
      setError('network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        onClick={() => { void handleClick(); }}
        disabled={loading}
        aria-label={`Buy ${label} pack — $${usd}`}
        className="w-full rounded-md bg-blue-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Redirecting…' : 'Buy →'}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
