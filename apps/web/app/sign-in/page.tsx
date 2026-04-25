'use client';
/**
 * app/sign-in/page.tsx — magic-link sign-in form (issue #79).
 *
 * Spec refs: §5.10 (CSP — no inline scripts/styles), §4.1 (stack).
 *
 * On submit: POST to /api/auth/magic-link with the user's email.
 * On success: show "Check your email" confirmation state.
 * On error: show validation / server error message.
 *
 * CSP notes:
 *   - No inline event handlers (uses React synthetic events, which are
 *     compiled to static JS — safe under script-src 'self').
 *   - No inline styles beyond Tailwind classes (className-only, no style={}).
 *   - No dynamic script injection.
 */

import { useState } from 'react';

type FormState = 'idle' | 'loading' | 'success' | 'error';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      setState('error');
      return;
    }

    setState('loading');
    setErrorMessage('');

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (res.status === 202) {
        setState('success');
      } else {
        const body = (await res.json()) as { error?: string };
        setErrorMessage(body.error ?? 'Something went wrong. Please try again.');
        setState('error');
      }
    } catch {
      setErrorMessage('Network error. Please check your connection and try again.');
      setState('error');
    }
  }

  if (state === 'success') {
    return (
      <main className="mx-auto max-w-md px-6 py-24">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Check your email</h1>
          <p className="mt-4 text-gray-600">
            We sent a sign-in link to <strong className="text-gray-900">{email}</strong>.
          </p>
          <p className="mt-2 text-sm text-gray-500">The link expires in 30 minutes.</p>
          <button
            type="button"
            className="mt-6 text-sm text-gray-500 underline hover:text-gray-700"
            onClick={() => {
              setState('idle');
              setEmail('');
            }}
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Sign in to willbuy.dev</h1>
        <p className="mt-2 text-sm text-gray-500">
          Enter your email and we will send you a one-click sign-in link.
        </p>

        <form className="mt-6" onSubmit={handleSubmit} noValidate>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-50"
            disabled={state === 'loading'}
          />

          {state === 'error' && errorMessage ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={state === 'loading'}
            className="mt-4 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50"
          >
            {state === 'loading' ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      </div>
    </main>
  );
}
