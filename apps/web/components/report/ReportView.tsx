'use client';

import type { ReportMode, ReportT } from './types';
import { DisagreementBanner } from './DisagreementBanner';
import { HeadlineDelta } from './HeadlineDelta';
import { Histograms } from './Histograms';
import { NextActions } from './NextActions';
import { PairedDots } from './PairedDots';
import { PersonaGrid } from './PersonaGrid';
import { ThemeBoard } from './ThemeBoard';
import { TierPicked } from './TierPicked';

// Spec §5.18 — composes the seven elements + the §2 #19 disagreement
// banner + the §9 low-power banner. Mode `public` strips the debug
// panel per "the same page read-only ... WITHOUT the debug view."

export function ReportView({
  report,
  mode,
}: {
  report: ReportT;
  mode: ReportMode;
}) {
  return (
    <div className="space-y-6">
      <DisagreementBanner headline={report.headline} />
      {report.meta.low_power ? (
        <div
          data-testid="low-power-banner"
          role="alert"
          className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900"
        >
          Low-power run (N &lt; 20). Treat all p-values as suggestive, not conclusive.
        </div>
      ) : null}
      <HeadlineDelta headline={report.headline} />
      <PairedDots rows={report.paired_dots} />
      <Histograms histograms={report.histograms} />
      <NextActions rows={report.next_actions} />
      <TierPicked rows={report.tier_picked} />
      <ThemeBoard board={report.theme_board} />
      <PersonaGrid personas={report.personas} />
      {mode === 'dashboard' ? (
        <section
          data-testid="debug-panel"
          className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-600"
        >
          <p className="font-semibold">Debug</p>
          <p className="mt-1">slug: {report.meta.slug} · n_paired: {report.headline.n_paired}</p>
        </section>
      ) : null}
    </div>
  );
}
