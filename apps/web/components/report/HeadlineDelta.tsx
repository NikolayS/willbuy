'use client';

import type { ReportT } from './types';

// Spec §5.18 #1 — large-type mean delta + 95% CI + N paired + paired-t
// + Wilcoxon + McNemar + one-sentence verdict. Disagreement banner per
// §2 #19 lives in <DisagreementBanner /> as its own component since the
// rule is named-and-tested.

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

function fmtP(p: number): string {
  // Standard convention: print exact value to 3 dp; clamp very small.
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}

function deltaSign(d: number): string {
  if (d > 0) return '+';
  return '';
}

const VERDICT_COPY: Record<ReportT['headline']['verdict'], string> = {
  better: 'NEW converts better.',
  worse: 'NEW converts worse.',
  inconclusive: 'Inconclusive — no clear winner.',
};

export const __test__ = { VERDICT_COPY };

export function HeadlineDelta({ headline }: { headline: ReportT['headline'] }) {
  const { mean_delta, ci95_low, ci95_high, n_paired, paired_t_p, wilcoxon_p, mcnemar_p, verdict } =
    headline;
  return (
    <section
      data-testid="headline-delta"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-bold tracking-tight text-gray-900">
            {deltaSign(mean_delta)}
            {fmt(mean_delta)}
          </span>
          <span className="text-sm uppercase tracking-wide text-gray-500">
            mean Δ will-to-buy
          </span>
        </div>
        <div className="text-sm text-gray-700">
          95% CI [{fmt(ci95_low)}, {fmt(ci95_high)}]
        </div>
        <div className="text-sm text-gray-700">N paired = {n_paired}</div>
      </div>
      <p className="mt-3 text-lg font-medium text-gray-800">
        {VERDICT_COPY[verdict]}
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-3">
        <div>
          <dt className="font-medium text-gray-900">paired-t</dt>
          <dd>{fmtP(paired_t_p)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-900">Wilcoxon signed-rank</dt>
          <dd>{fmtP(wilcoxon_p)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-900">McNemar (binary)</dt>
          <dd>{fmtP(mcnemar_p)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-gray-500">
        Note: the conversion-weighted score (which gives <code>contact_sales</code> weight 0.8) is a
        different quantity than the McNemar binarization (which counts <code>contact_sales</code>
        as <code>converted=1</code>). Don&rsquo;t conflate them.
      </p>
    </section>
  );
}
