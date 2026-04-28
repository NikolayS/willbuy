'use client';

// ShareLinkButton — mints a private revocable share link for a ready study's report.
// Issue #487, spec §2 #20 (user story 3: CRO consultant mints a share link for a client).
//
// Calls POST /api/studies/:id/share-token (session-cookie auth).
// On 201: shows the full URL in a <code> block + Copy button (clipboard API).
// On 409: shows "A share link already exists — revoke it first" in muted text.
// On other error: shows a brief error message (data-testid="share-link-error").

import React, { useState } from 'react';

interface ShareLinkButtonProps {
  studyId: string | number;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; url: string }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

export function ShareLinkButton({ studyId }: ShareLinkButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/studies/${studyId}/share-token`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.status === 201) {
        const body = (await res.json()) as { token: string; url: string; expires_at: string };
        setState({ kind: 'done', url: body.url });
        return;
      }

      if (res.status === 409) {
        setState({ kind: 'conflict' });
        return;
      }

      // Other error — show brief message.
      const isJson = res.headers.get('content-type')?.includes('application/json');
      const msg = isJson
        ? ((await res.json()) as { error?: string }).error ?? 'failed to create share link'
        : 'failed to create share link — please try again';
      setState({ kind: 'error', message: msg });
    } catch {
      setState({ kind: 'error', message: 'network error — please try again' });
    }
  }

  async function handleCopy(url: string) {
    // Try modern Clipboard API first.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // fall through to legacy fallback
      }
    }
    // Legacy fallback: hidden textarea + execCommand('copy'). Works in more
    // contexts (no Permissions-Policy, no Clipboard-API gating).
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // last-ditch: nothing more we can do
    }
  }

  if (state.kind === 'done') {
    return (
      <div className="mt-3">
        <p className="text-xs text-gray-500 mb-1">
          Share this link — it expires in 90 days. Anyone with the link can view the report.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="block flex-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-800 break-all">
            {state.url}
          </code>
          <button
            onClick={() => { void handleCopy(state.url); }}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'conflict') {
    return (
      <div className="mt-3">
        <p className="text-xs text-gray-500">
          A share link already exists — revoke it first (coming soon)
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => { void handleClick(); }}
        disabled={state.kind === 'loading'}
        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.kind === 'loading' ? 'Generating link…' : 'Get private share link'}
      </button>
      {state.kind === 'error' && (
        <p className="mt-1 text-xs text-red-600" data-testid="share-link-error">
          {state.message}
        </p>
      )}
    </div>
  );
}
