'use client';

// Client component so BuyButton can use useState/fetch.
// Receives isAuthenticated from the server component (cookie check).

import { BuyButton } from '../dashboard/credits/BuyButton';

interface PricingCtaProps {
  packId: 'starter' | 'growth' | 'scale';
  label: string;
  usd: number;
  isAuthenticated: boolean;
}

export function PricingCta({ packId, label, usd, isAuthenticated }: PricingCtaProps) {
  if (isAuthenticated) {
    return <BuyButton packId={packId} label={label} usd={usd} />;
  }
  return (
    <a
      href={`/sign-in?redirect=/pricing&pack=${packId}`}
      aria-label={`Buy ${label} pack — $${usd}`}
      className="mt-4 inline-block w-full rounded-md bg-blue-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      Buy →
    </a>
  );
}
