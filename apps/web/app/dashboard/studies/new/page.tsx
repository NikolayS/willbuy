'use client';

/**
 * /dashboard/studies/new — study creation form (issue #34).
 *
 * Spec refs:
 *   §2 #1  — verified-domain check is server-side; we surface the 422 error.
 *   §2 #18 — paired A/B = exactly 2 URLs.
 *   §4.1   — form: URLs (1 or 2), ICP picker (5 presets), N slider (5–100).
 *   §3     — Mira, Kenji, Dana, dogfood user stories.
 *   §5.10  — CSP: no dangerouslySetInnerHTML; all text escaped by React.
 *
 * Auth: Sprint 3. For v0.1 the api-client reads NEXT_PUBLIC_DEV_API_KEY.
 *
 * On success → router.push(/dashboard/studies/:id).
 * On 401     → router.push(/dashboard/sign-in) (placeholder).
 * On 402     → inline "out of credits" + /dashboard/credits link.
 * On 422 "unverified domain" → inline message + verify-domain link.
 */

import React from 'react';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createStudy, ICP_PRESETS, type IcpPresetId } from '../../../../lib/api-client';

// Human-readable labels for ICP presets (spec §2 #9).
const ICP_LABELS: Record<IcpPresetId, string> = {
  saas_founder_pre_pmf: 'SaaS founder — pre-PMF',
  saas_founder_post_pmf: 'SaaS founder — post-PMF',
  shopify_merchant: 'Shopify merchant',
  devtools_engineer: 'Dev-tools engineer',
  fintech_ops_buyer: 'Fintech ops buyer',
};

export default function StudyNewPage() {
  const router = useRouter();

  // ── Form state ────────────────────────────────────────────────────────────
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [icpId, setIcpId] = useState<IcpPresetId>('saas_founder_pre_pmf');
  const [nVisits, setNVisits] = useState(30);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<{
    kind: 'unverified_domain' | 'cap_exceeded' | 'generic';
    message: string;
  } | null>(null);

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldError(null);
    setApiError(null);

    // Client-side validation: at least URL A is required.
    const trimmedA = urlA.trim();
    if (!trimmedA) {
      setFieldError('URL is required. Please enter a valid URL.');
      return;
    }
    if (isPaired) {
      const trimmedB = urlB.trim();
      if (!trimmedB) {
        setFieldError('URL B is required for paired A/B study. Please enter a valid URL.');
        return;
      }
    }

    const urls = isPaired ? [trimmedA, urlB.trim()] : [trimmedA];

    setSubmitting(true);
    try {
      const result = await createStudy({ urls, icp: { preset_id: icpId }, n_visits: nVisits });

      if (result.ok) {
        router.push(`/dashboard/studies/${result.data.study_id}`);
        return;
      }

      // Map API error codes to inline error UI.
      if (result.status === 401) {
        router.push('/sign-in?redirect=%2Fdashboard%2Fstudies%2Fnew');
        return;
      }
      if (result.status === 402) {
        setApiError({ kind: 'cap_exceeded', message: result.error });
        return;
      }
      if (result.status === 422 && result.error.toLowerCase().includes('unverified')) {
        setApiError({ kind: 'unverified_domain', message: result.error });
        return;
      }
      setApiError({ kind: 'generic', message: result.error });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">New study</h1>
      <p className="mt-2 text-gray-600">
        Paste a URL, pick an ICP, and N synthetic visitors will render your page and return
        structured feedback.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-8" noValidate>

        {/* ── URL inputs ── */}
        <section>
          <h2 className="text-lg font-semibold">Target URL{isPaired ? 's' : ''}</h2>

          <div className="mt-3 space-y-3">
            {/* URL A */}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                {isPaired ? 'URL A' : 'URL'}
              </span>
              <input
                aria-label={isPaired ? 'URL A' : 'URL'}
                type="url"
                value={urlA}
                onChange={(e) => setUrlA(e.target.value)}
                placeholder="https://example.com/pricing"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                disabled={submitting}
              />
            </label>

            {/* URL B (paired) */}
            {isPaired && (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">URL B</span>
                <input
                  aria-label="URL B"
                  type="url"
                  value={urlB}
                  onChange={(e) => setUrlB(e.target.value)}
                  placeholder="https://example.com/pricing-v2"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  disabled={submitting}
                />
              </label>
            )}

            {/* Toggle paired */}
            {!isPaired ? (
              <button
                type="button"
                onClick={() => setIsPaired(true)}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                + Add second URL for paired A/B
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setIsPaired(false); setUrlB(''); }}
                className="text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                − Remove second URL (switch to single)
              </button>
            )}
          </div>

          {/* Client-side validation error */}
          {fieldError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {fieldError}
            </p>
          )}
        </section>

        {/* ── ICP picker ── */}
        <section>
          <h2 className="text-lg font-semibold">Ideal customer profile (ICP)</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pick the persona type your visitors should embody.
          </p>
          <div className="mt-3 space-y-2">
            {ICP_PRESETS.map((preset) => (
              <label
                key={preset}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="icp"
                  value={preset}
                  checked={icpId === preset}
                  onChange={() => setIcpId(preset)}
                  className="h-4 w-4 text-indigo-600"
                  disabled={submitting}
                />
                <span className="text-sm font-medium text-gray-800">
                  {ICP_LABELS[preset]}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* ── N slider ── */}
        <section>
          <h2 className="text-lg font-semibold">
            Number of visitors (N = {nVisits})
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            5–100. Default 30. Each visitor is an independent fresh-context LLM call.
          </p>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={nVisits}
            onChange={(e) => setNVisits(Number(e.target.value))}
            className="mt-3 w-full accent-indigo-600"
            disabled={submitting}
            aria-label="Number of visitors"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>5</span>
            <span>100</span>
          </div>
          {/* Live cost estimate: avg 3.5¢/visit (ceiling 5¢ reserved by API §5.5) */}
          <p className="mt-2 text-xs text-gray-500">
            Estimated cost: ~${((isPaired ? 2 : 1) * nVisits * 3.5 / 100).toFixed(2)}
            {' '}({(isPaired ? 2 : 1) * nVisits} visitor{(isPaired ? 2 : 1) * nVisits !== 1 ? 's' : ''} × avg 3.5¢)
          </p>
        </section>

        {/* ── API error banners ── */}
        {apiError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            {apiError.kind === 'unverified_domain' && (
              <>
                <p className="text-sm font-medium text-red-800">
                  This domain is not verified for your account.
                </p>
                <p className="mt-1 text-sm text-red-700">{apiError.message}</p>
                <div className="mt-2 flex gap-3">
                  <a
                    href="/dashboard/domains/new"
                    className="text-sm font-medium text-indigo-600 hover:underline"
                  >
                    Verify domain
                  </a>
                  <span className="text-sm text-red-400">|</span>
                  <button
                    type="button"
                    onClick={() => { setApiError(null); setUrlA(''); setUrlB(''); }}
                    className="text-sm font-medium text-indigo-600 hover:underline"
                  >
                    Use a different URL
                  </button>
                </div>
              </>
            )}
            {apiError.kind === 'cap_exceeded' && (
              <>
                <p className="text-sm font-medium text-red-800">
                  {"You don't have enough credits for this study."}
                </p>
                <p className="mt-1 text-sm text-red-700">
                  Buy a credit pack to run synthetic visitor studies.
                </p>
                <a
                  href="/dashboard/credits"
                  className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline"
                >
                  Buy credits →
                </a>
              </>
            )}
            {apiError.kind === 'generic' && (
              <p className="text-sm text-red-800">{apiError.message}</p>
            )}
          </div>
        )}

        {/* ── Submit ── */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60"
        >
          {submitting ? 'Creating study…' : 'Start study'}
        </button>
      </form>
    </main>
  );
}
