'use client';

// PublishButton — makes a ready study's report publicly accessible.
// Calls POST /api/studies/:id/publish (session-cookie auth).

import React, { useState } from 'react';

interface PublishButtonProps {
  studyId: string | number;
  reportSlug: string;
}

export function PublishButton({ studyId, reportSlug }: PublishButtonProps) {
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (published) {
    return (
      <div className="mt-3">
        <p className="text-sm text-green-700 font-medium">
          Report is now public —{' '}
          <a href={`/r/${reportSlug}`} className="underline hover:text-green-900">
            share this link
          </a>
        </p>
      </div>
    );
  }

  async function handlePublish() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/studies/${studyId}/publish`, { method: 'POST' });
      if (res.ok) {
        setPublished(true);
      } else {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const msg = isJson
          ? ((await res.json()) as { error?: string }).error ?? 'publish failed'
          : 'publish failed — please try again';
        setError(msg);
      }
    } catch {
      setError('network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => { void handlePublish(); }}
        disabled={loading}
        className="rounded-md border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Publishing…' : 'Make report public'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
