import type { Metadata } from 'next';

// SPEC §5.10: /r/* is the public-report render boundary. We mark it
// noindex here AND apply the strict CSP via middleware.ts. Real report
// rendering (§5.18) lands in a follow-up issue once the data shape is
// stable; this page exists only to anchor the route + headers.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Touch the param so the route is treated as dynamic per slug. The
  // slug is rendered as <code> text — never as a hyperlink — per §5.10.
  const { slug } = await params;
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Public report — pending implementation</h1>
      <p className="mt-6 text-gray-700">
        Report <code>{slug}</code> will render once §5.18 is implemented.
      </p>
    </main>
  );
}
