import type { Metadata } from 'next';

import { Report, type ReportT } from '@willbuy/shared/report';
import { ReportCtaBar } from '../../../components/report/ReportCtaBar';
import { ReportView } from '../../../components/report/ReportView';
import { fetchReport } from './fetchReport';

// Spec §5.10: /r/* is the public-report render boundary. The strict CSP
// is applied in middleware.ts; we mark the route noindex here and rely
// on the CSP header for inline-script discipline.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchReport(slug);

  if (result === 'not_found' || result === null) {
    return (
      <>
        <main className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-bold tracking-tight">Report not found</h1>
          <p className="mt-6 text-gray-700">
            No report exists for <code>{slug}</code>, or the share link has been revoked.
          </p>
        </main>
        <ReportCtaBar />
      </>
    );
  }

  if (result === 'pending') {
    return (
      <>
        <main className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-bold tracking-tight">Report is being prepared</h1>
          <p className="mt-6 text-gray-700">
            The analysis for <code>{slug}</code> is still running. Refresh in a moment.
          </p>
        </main>
        <ReportCtaBar />
      </>
    );
  }

  // Parse at the boundary (per CLAUDE.md zod-at-the-boundary rule).
  // Anything that fails this validation is an aggregator-side bug and
  // we'd rather 500 than render a malformed report.
  const report: ReportT = Report.parse(result);
  return (
    <>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">willbuy.dev — public report</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Study <code className="text-base">{report.meta.slug}</code>
          </h1>
        </header>
        <ReportView report={report} mode="public" />
      </main>
      <ReportCtaBar />
    </>
  );
}
