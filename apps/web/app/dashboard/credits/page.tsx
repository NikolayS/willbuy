/**
 * /dashboard/credits — credit balance + pack purchase (issue #206).
 *
 * Server Component. Fetches /api/dashboard/summary for the current balance,
 * redirects to /sign-in if unauthenticated (401), and renders the pack tiles.
 *
 * ?success=1  — shown after Stripe redirect on successful payment
 * ?cancelled=1 — shown after Stripe redirect on cancelled payment
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BuyButton } from './BuyButton';

export const dynamic = 'force-dynamic';

interface DashboardSummary {
  balance_cents: number;
}

interface Pack {
  id: 'starter' | 'growth' | 'scale';
  label: string;
  usd: number;
  credits: number;
  visitEstimate: number;
}

const PACKS: Pack[] = [
  { id: 'starter', label: 'Starter', usd: 29, credits: 1_000, visitEstimate: Math.floor(2900 / 3.5) },
  { id: 'growth', label: 'Growth', usd: 99, credits: 4_000, visitEstimate: Math.floor(9900 / 3.5) },
  { id: 'scale', label: 'Scale', usd: 299, credits: 15_000, visitEstimate: Math.floor(29900 / 3.5) },
];

function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://localhost:3001';
}

function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remaining = cents % 100;
  return `$${dollars}.${String(remaining).padStart(2, '0')}`;
}

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; cancelled?: string }>;
}) {
  // In Next 14 cookies() is sync; in Next 15 it became async. Cast to
  // accommodate both without pulling in version-specific types.
  const cookieStore = (cookies() as unknown) as {
    getAll: () => Array<{ name: string; value: string }>;
  };
  const all = cookieStore.getAll();
  const cookieHeader = all.map((c) => `${c.name}=${c.value}`).join('; ');

  // In production the cookie is __Host-wb_session; in dev it is wb_session.
  const hasSession = all.some(
    (c) => c.name === 'wb_session' || c.name === '__Host-wb_session',
  );
  if (!hasSession) {
    redirect('/sign-in?redirect=%2Fdashboard%2Fcredits');
  }

  const params = await searchParams;
  const didSucceed = params.success === '1';
  const didCancel = params.cancelled === '1';

  let balance_cents = 0;
  try {
    const res = await fetch(`${apiBaseUrl()}/api/dashboard/summary`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 401) redirect('/sign-in?redirect=%2Fdashboard%2Fcredits');
    if (res.ok) {
      const data = (await res.json()) as DashboardSummary;
      balance_cents = data.balance_cents;
    }
  } catch {
    redirect('/sign-in?redirect=%2Fdashboard%2Fcredits');
  }

  const balanceVisits = Math.max(0, Math.floor(balance_cents / 3.5));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Stripe redirect banners */}
      {didSucceed && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Payment successful — your credits have been added.
        </div>
      )}
      {didCancel && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Payment cancelled. Your account has not been charged.
        </div>
      )}

      {/* Balance card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-gray-500">Current balance</p>
        <p className="mt-1 text-4xl font-bold text-gray-900">
          {formatCents(balance_cents)}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          ≈ {balanceVisits.toLocaleString()} visits remaining
        </p>
      </div>

      {/* Top-up section */}
      <h2 className="mt-10 text-xl font-semibold text-gray-900">Top up credits</h2>
      <p className="mt-1 text-sm text-gray-600">
        Credits are consumed per visit (avg 3.5¢, ceiling 5¢).
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        {PACKS.map((pack) => (
          <div
            key={pack.id}
            className="flex flex-col rounded-xl border border-gray-200 bg-white px-6 py-8 shadow-sm"
          >
            <span className="text-lg font-semibold text-gray-900">{pack.label}</span>
            <span className="mt-2 text-4xl font-bold text-gray-900">${pack.usd}</span>
            <span
              className="mt-3 text-sm text-gray-600"
              title="avg 3.5¢/visit; ceiling 5¢"
            >
              {pack.credits.toLocaleString()} credits (~{pack.visitEstimate.toLocaleString()} visits)
            </span>
            <BuyButton packId={pack.id} label={pack.label} usd={pack.usd} />
          </div>
        ))}
      </div>
    </div>
  );
}
