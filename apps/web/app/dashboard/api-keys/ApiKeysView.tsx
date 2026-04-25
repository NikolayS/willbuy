/**
 * ApiKeysView.tsx — pure presentational renderer for the API-key list page
 * (issue #81).
 *
 * Server-Component-friendly — no client hooks, no inline event handlers,
 * no inline <script>. Imported by:
 *   - apps/web/app/dashboard/api-keys/page.tsx (production: SSR-fetches API)
 *   - apps/web/test/api-keys.test.tsx (renderToStaticMarkup with fixtures)
 *
 * Spec refs:
 *   §3       — user stories: list keys, create, revoke
 *   §4.1     — API-key auth is the v0.1 primary surface for programmatic access
 *   §5.10    — CSP: no inline scripts/styles, className-only Tailwind
 *   §2 #21   — ≤ 2 active keys per account (the cap message helps the user)
 *   §2 #22   — keys are masked everywhere except the one-time create response
 *
 * "Revoke" buttons render as a tiny <form method="post"> with a hidden
 * `_method=DELETE` input. The /dashboard/api-keys page handles the POST in
 * its Route Handler (page.tsx → POST handler) and forwards a real DELETE
 * to /api/api-keys/:id. This keeps the UI working without client-side JS,
 * which is the CSP-correct shape.
 */

import type { ReactElement } from 'react';

export interface ApiKeyRow {
  id: number;
  label: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function statusBadge(row: ApiKeyRow): ReactElement {
  if (row.revoked_at) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
        revoked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-200">
      active
    </span>
  );
}

export function ApiKeysView({ keys }: { keys: ApiKeyRow[] }): ReactElement {
  const activeCount = keys.filter((k) => !k.revoked_at).length;
  const atCap = activeCount >= 2;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">API keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Use these to authenticate programmatic requests. Each account may have
            up to 2 active keys (revoked keys are kept for audit).
          </p>
        </div>
        {atCap ? (
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center rounded-md bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500"
            title="Revoke an existing key to create a new one"
          >
            Create new key
          </span>
        ) : (
          <a
            href="/dashboard/api-keys/new"
            className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Create new key
          </a>
        )}
      </header>

      {keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm text-gray-700">
            No API keys yet — create one to authenticate programmatic requests.
          </p>
          <a
            href="/dashboard/api-keys/new"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
          >
            Create your first key
          </a>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Label
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Prefix
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Created
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Last used
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {k.label || <span className="italic text-gray-400">unlabeled</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">
                    {k.prefix}…
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatTimestamp(k.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatTimestamp(k.last_used_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">{statusBadge(k)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    {k.revoked_at ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <form
                        method="post"
                        action={`/dashboard/api-keys/${k.id}/revoke`}
                        className="inline"
                      >
                        <button
                          type="submit"
                          className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                        >
                          Revoke
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * NewKeyResultView — shown immediately after a successful POST /api/api-keys.
 * Displays the raw key value ONCE with an unmistakable "save now" warning.
 *
 * No copy-to-clipboard button — the dashboard CSP blocks the Clipboard API
 * (Permissions-Policy: clipboard-read=(), clipboard-write=()). The user
 * selects + copies manually; we surface the key inside a clearly-bordered
 * monospaced block to make selection unambiguous.
 */
export function NewKeyResultView({
  apiKey,
  label,
  prefix,
}: {
  apiKey: string;
  label: string;
  prefix: string;
}): ReactElement {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        Your new API key
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        Label: <span className="font-medium text-gray-700">{label}</span>{' '}
        <span className="text-gray-400">(prefix {prefix}…)</span>
      </p>

      <div
        role="alert"
        className="mt-6 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3"
      >
        <p className="text-sm font-semibold text-yellow-900">
          Save this key now — it will not be shown again.
        </p>
        <p className="mt-1 text-sm text-yellow-800">
          Treat it like a password. Store it in your secrets manager. If you lose
          it, revoke this key and create a new one.
        </p>
      </div>

      <div className="mt-6">
        <label
          htmlFor="api-key-display"
          className="block text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          API key
        </label>
        <pre
          id="api-key-display"
          className="mt-2 overflow-x-auto rounded-md border border-gray-300 bg-gray-50 px-4 py-3 font-mono text-sm text-gray-900"
        >
          {apiKey}
        </pre>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <a
          href="/dashboard/api-keys"
          className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          I have saved this key — done
        </a>
      </div>
    </div>
  );
}

/**
 * NewKeyFormView — pre-submit form. Plain HTML <form> that POSTs to
 * /dashboard/api-keys/new (a Route Handler in page.tsx-adjacent route.ts)
 * which proxies the create call to the API and renders NewKeyResultView.
 *
 * Spec §5.10 — no client JS, form-action='self' satisfies the CSP.
 */
export function NewKeyFormView({
  error,
  initialLabel,
}: {
  error?: string;
  initialLabel?: string;
}): ReactElement {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        Create a new API key
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        Pick a label that helps you remember where this key is used (e.g. "CI
        deploy", "production worker"). The raw key value is shown only once.
      </p>

      {error ? (
        <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      ) : null}

      <form
        method="post"
        action="/dashboard/api-keys/create"
        className="mt-8 space-y-6"
        noValidate
      >
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Label</span>
          <input
            type="text"
            name="label"
            required
            maxLength={80}
            defaultValue={initialLabel ?? ''}
            placeholder="CI deploy"
            aria-label="Label"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Create key
          </button>
          <a
            href="/dashboard/api-keys"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
