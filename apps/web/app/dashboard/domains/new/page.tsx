'use client';

/**
 * /dashboard/domains/new — domain verification flow (issue #82).
 *
 * Spec refs:
 *   §2 #1  — verified-domain authorization in v0.1 (DNS TXT, /.well-known, <meta>).
 *   §4.1   — Next.js App Router + Tailwind.
 *   §5.10  — CSP: no inline scripts; no dangerouslySetInnerHTML.
 *
 * UX (single-page):
 *   1. Idle → user types domain → submits.
 *   2. Loading → POST /api/domains → server returns token + 3 instructions.
 *   3. Instructions → display TXT / well-known / <meta> options.
 *      "Verify now" button → POST /api/domains/<domain>/verify.
 *   4. Verified → show "✅ Verified" message + redirect to /dashboard/domains.
 *
 * Auth: requires a valid wb_session cookie (set by /sign-in flow). The API
 * returns 401 if missing — we surface that with a "Please sign in" link.
 *
 * Spec calls this a Server Component but the page is inherently interactive
 * (form, verify button polls); we use 'use client' with a single page like
 * the existing /sign-in flow.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Methods = {
  dns: string;
  well_known: string;
  meta: string;
};

type Stage = 'idle' | 'requesting' | 'instructions' | 'verifying' | 'verified' | 'error';

interface Challenge {
  domain: string;
  verify_token: string;
  methods: Methods;
}

export default function DomainsNewPage() {
  const router = useRouter();

  const [domain, setDomain] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  async function handleRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setVerifyMessage(null);

    const trimmed = domain.trim();
    if (!trimmed) {
      setErrorMessage('Please enter a domain.');
      return;
    }

    setStage('requesting');
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: trimmed }),
      });
      if (res.status === 401) {
        setStage('error');
        setErrorMessage('Please sign in to verify a domain.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStage('error');
        setErrorMessage(body.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as Challenge;
      setChallenge(body);
      setStage('instructions');
    } catch (err) {
      setStage('error');
      setErrorMessage(`Network error: ${String(err)}`);
    }
  }

  async function handleVerify() {
    if (!challenge) return;
    setStage('verifying');
    setVerifyMessage(null);
    try {
      const res = await fetch(
        `/api/domains/${encodeURIComponent(challenge.domain)}/verify`,
        { method: 'POST' },
      );
      if (res.status === 401) {
        setStage('error');
        setErrorMessage('Please sign in to verify a domain.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStage('instructions');
        setVerifyMessage(body.error ?? `Verification request failed (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as { verified: boolean; method?: string };
      if (body.verified) {
        setStage('verified');
        // Redirect to dashboard list.
        setTimeout(() => router.push('/dashboard/domains'), 1500);
        return;
      }
      // No method matched yet — leave the user on the instructions screen so
      // they can re-try after publishing.
      setStage('instructions');
      setVerifyMessage(
        "We couldn't find the verification token. Publish one of the three options above and try again.",
      );
    } catch (err) {
      setStage('instructions');
      setVerifyMessage(`Network error: ${String(err)}`);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Verify a domain</h1>
      <p className="mt-2 text-gray-600">
        Add a domain to your account so you can run studies against its pages.
        Pick any one of the three verification methods below.
      </p>

      {(stage === 'idle' || stage === 'requesting' || stage === 'error') && (
        <form onSubmit={handleRequest} className="mt-8 space-y-4" noValidate>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Domain</span>
            <input
              type="text"
              aria-label="Domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={stage === 'requesting'}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          {errorMessage && (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage}
            </p>
          )}
          <button
            type="submit"
            disabled={stage === 'requesting'}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60"
          >
            {stage === 'requesting' ? 'Requesting…' : 'Continue'}
          </button>
        </form>
      )}

      {(stage === 'instructions' || stage === 'verifying') && challenge && (
        <section className="mt-10 space-y-6">
          <h2 className="text-xl font-semibold">
            Verify <span className="font-mono">{challenge.domain}</span>
          </h2>
          <p className="text-sm text-gray-600">
            Pick any one of these three options, publish it on the domain, then click
            <span className="font-medium"> Verify now</span>.
          </p>

          {/* DNS */}
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold">Option 1 — DNS TXT record</h3>
            <p className="mt-1 text-sm text-gray-600">
              Add a TXT record on <span className="font-mono">{challenge.domain}</span>:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-gray-900 px-3 py-2 text-xs text-gray-100">
              willbuy-verify={challenge.verify_token}
            </pre>
          </div>

          {/* well-known */}
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold">Option 2 — /.well-known file</h3>
            <p className="mt-1 text-sm text-gray-600">
              Serve <span className="font-mono">/.well-known/willbuy-verify</span> with the
              token as the response body:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-gray-900 px-3 py-2 text-xs text-gray-100">
              {challenge.verify_token}
            </pre>
          </div>

          {/* meta */}
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold">Option 3 — &lt;meta&gt; tag</h3>
            <p className="mt-1 text-sm text-gray-600">
              Add this to the &lt;head&gt; of your home page (
              <span className="font-mono">https://{challenge.domain}/</span>):
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-gray-900 px-3 py-2 text-xs text-gray-100">
              {`<meta name="willbuy-verify" content="${challenge.verify_token}">`}
            </pre>
          </div>

          {verifyMessage && (
            <p role="alert" className="text-sm text-red-600">
              {verifyMessage}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleVerify}
              disabled={stage === 'verifying'}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60"
            >
              {stage === 'verifying' ? 'Verifying…' : 'Verify now'}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setVerifyMessage(null);
                setStage('idle');
              }}
              className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {stage === 'verified' && challenge && (
        <section className="mt-10 rounded-lg border border-green-300 bg-green-50 p-6">
          <p className="text-lg font-semibold text-green-800">
            {/* Cleartext check mark; spec §5.10 forbids dangerouslySetInnerHTML. */}
            {'✅'} Verified
          </p>
          <p className="mt-2 text-sm text-green-700">
            <span className="font-mono">{challenge.domain}</span> has been added to your
            account. Redirecting…
          </p>
          <a
            href="/dashboard/domains"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
          >
            Go to domains list
          </a>
        </section>
      )}
    </main>
  );
}
