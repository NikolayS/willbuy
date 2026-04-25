'use client';

import type { ReportT } from './types';

// Spec §2 #19 — paired-t and Wilcoxon disagreement rule. When one
// p < 0.05 and the other p ≥ 0.05, the report surfaces an explicit
// banner, the conclusion is labeled "weak — tests disagree," and the
// ship-gate copy uses the MORE CONSERVATIVE (larger) p-value.

export function DisagreementBanner({ headline }: { headline: ReportT['headline'] }) {
  if (!headline.disagreement) return null;
  const conservativeP = Math.max(headline.paired_t_p, headline.wilcoxon_p);
  return (
    <div
      data-testid="disagreement-banner"
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <p className="font-semibold text-amber-900">
        Weak — tests disagree (paired-t and Wilcoxon).
      </p>
      <p className="mt-1 text-sm text-amber-900">
        Reading the conservative (larger) p-value: {conservativeP.toFixed(3)}.
        Per spec §2 #19, this run does not clear the significance bar; do not
        ship a copy change off this study alone.
      </p>
    </div>
  );
}
