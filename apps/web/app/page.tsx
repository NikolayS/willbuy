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
        consistent backstories.{' '}
        <a className="underline" href={SPEC_URL} rel="noopener noreferrer">
          Read the spec
        </a>
        .
      </p>
    </main>
  );
}
