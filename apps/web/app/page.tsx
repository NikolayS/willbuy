// TODO: link to a public spec URL once published. Until then we point to
// the GitHub repo root, which is intentionally generic and contains no
// secret-sauce architecture details (those live in .samo/ behind review).
const SPEC_URL = 'https://github.com/NikolayS/willbuy';

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">
        willbuy.dev — synthetic visitor panel
      </h1>
      <p className="mt-6 text-lg text-gray-700">
        Pre-launch landing-page A/B tests run by paired LLM visitors with
        consistent backstories.
      </p>

      {/* Primary + secondary CTAs */}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <a
          href="/pricing"
          className="rounded-md bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          See pricing →
        </a>
        <a
          href="/r/test-fixture"
          className="rounded-md border border-indigo-600 px-6 py-3 text-base font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          See a sample report
        </a>
      </div>

      {/* Tertiary CTA — text link only, not a button */}
      <p className="mt-4 text-sm text-gray-600">
        <a href="/sign-in" className="underline hover:text-gray-900">
          Sign in
        </a>
      </p>

      {/* Footer — spec link demoted from primary position */}
      <footer className="mt-16 border-t border-gray-200 pt-6">
        <p className="text-xs text-gray-400">
          <a
            href={SPEC_URL}
            rel="noopener noreferrer"
            className="underline hover:text-gray-600"
          >
            Read the technical spec ↗
          </a>
        </p>
      </footer>
    </main>
  );
}
