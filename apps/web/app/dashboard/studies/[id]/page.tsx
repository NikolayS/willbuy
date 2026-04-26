'use client';

/**
 * /dashboard/studies/[id] — live study status page (issue #34).
 *
 * Spec refs:
 *   §5.3  — status: pending | capturing | visiting | aggregating | ready | failed
 *   §4.1  — web app dashboard
 *   §5.10 — CSP: no inline scripts; all text escaped by React
 *
 * Polls GET /studies/:id every 5 s until status reaches a terminal state
 * (ready | failed).
 *
 * When ready → links to /r/:slug (report viz, PR #44).
 * When failed → shows error message + retry CTA (placeholder for Sprint 3).
 *
 * Note: Next.js 14 App Router passes `params` as a Promise in newer builds.
 * We unwrap it safely via useEffect on mount for client-component compat.
 */

import React from 'react';
import { useState, useEffect } from 'react';
import { getStudy, type GetStudyResponse, type StudyStatus } from '../../../../lib/api-client';

// Poll interval in milliseconds (spec: 5 s).
const POLL_INTERVAL_MS = 5_000;

// Terminal statuses — stop polling when reached.
const TERMINAL: StudyStatus[] = ['ready', 'failed'];

// Human-readable status labels.
const STATUS_LABELS: Record<StudyStatus, string> = {
  pending: 'Pending',
  capturing: 'Capturing page',
  visiting: 'Visitors running',
  aggregating: 'Aggregating results',
  ready: 'Ready',
  failed: 'Failed',
};

// Tailwind colour classes per status.
const STATUS_COLOURS: Record<StudyStatus, string> = {
  pending: 'text-gray-500',
  capturing: 'text-blue-600',
  visiting: 'text-indigo-600',
  aggregating: 'text-indigo-600',
  ready: 'text-green-600',
  failed: 'text-red-600',
};

// ── Visit progress bar ────────────────────────────────────────────────────────

function ProgressBar({ ok, failed, total }: { ok: number; failed: number; total: number }) {
  if (total === 0) return null;
  const okPct = Math.round((ok / total) * 100);
  const failedPct = Math.round((failed / total) * 100);

  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>
          {ok} / {total} visitors complete{failed > 0 ? ` (${failed} failed)` : ''}
        </span>
        <span>{okPct}%</span>
      </div>
      {/* Combined bar: green=ok, red=failed, gray=pending */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full bg-green-500 float-left"
          style={{ width: `${okPct}%` }}
        />
        <div
          className="h-full bg-red-400 float-left"
          style={{ width: `${failedPct}%` }}
        />
      </div>
    </div>
  );
}

// ── Inner component (receives resolved id string) ─────────────────────────────

function StudyStatusInner({ id }: { id: string }) {
  const [study, setStudy] = useState<GetStudyResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch once on mount, then poll every 5 s until terminal.
  useEffect(() => {
    let cancelled = false;

    async function fetchStudy() {
      const result = await getStudy(id);
      if (cancelled) return;

      if (result.ok) {
        setStudy(result.data);
        setLoadError(null);
        // Issue #74 MINOR-1: stop polling once terminal status is reached.
        // Without this, the page keeps hitting GET /studies/:id every 5 s
        // forever as long as the tab stays open.
        const s = result.data.status;
        if (s === 'ready' || s === 'failed') {
          clearInterval(interval);
        }
      } else {
        setLoadError(result.error);
      }
    }

    // Initial fetch.
    void fetchStudy();

    // Set up polling interval (declared after fetchStudy so it's referenceable
    // inside the closure without `let` — Issue #74 MINOR-1).
    const interval = setInterval(() => {
      void fetchStudy();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (!study && !loadError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-gray-500">Loading study…</p>
      </main>
    );
  }

  // ── Load error ───────────────────────────────────────────────────────────
  if (loadError && !study) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-red-600">Error loading study: {loadError}</p>
      </main>
    );
  }

  const s = study!;
  // Narrow status to the literal-union key type so the Record indexes type-check.
  const status = s.status as StudyStatus;
  const isTerminal = TERMINAL.includes(status);
  const progress = s.visit_progress;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      {/* Study ID header */}
      <h1 className="text-3xl font-bold tracking-tight">Study #{s.id}</h1>

      {/* Status badge */}
      <div className="mt-4 flex items-center gap-2">
        <span
          className={`text-lg font-semibold ${STATUS_COLOURS[status]}`}
          data-testid="study-status"
        >
          {STATUS_LABELS[status]}
        </span>
        {!isTerminal && (
          <span className="animate-pulse text-gray-400 text-sm">polling every 5 s…</span>
        )}
      </div>

      {/* Visit progress bar */}
      <ProgressBar ok={progress.ok} failed={progress.failed} total={progress.total} />

      {/* Ready state: link to report */}
      {status === 'ready' && (
        <div className="mt-8 rounded-lg border border-green-200 bg-green-50 px-5 py-4">
          <p className="text-sm font-medium text-green-800">
            Your study is ready! View the report to see results.
          </p>
          {/* Issue #74 MINOR-2: GET /studies/:id returns the study's slug
              field (per PR #102 dashboard-summary endpoint pattern). Use it
              when available; fall back to /r/${s.id} (matches the bare-id
              shape used by /dashboard/studies/StudiesListView). The previous
              fallback (/r/study-${s.id}) would 404. */}
          <a
            href={s.slug ? `/r/${s.slug}` : `/r/${s.id}`}
            className="mt-3 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            View report
          </a>
        </div>
      )}

      {/* Failed state: error + retry CTA */}
      {status === 'failed' && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-800">
            This study failed. This can happen if the page was unreachable or
            the domain was blocked.
          </p>
          {/* Retry is a Sprint 3 feature; placeholder link */}
          <a
            href="/dashboard/studies/new"
            className="mt-3 inline-block rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
          >
            Try again with a new study
          </a>
        </div>
      )}

      {/* Started at */}
      <p className="mt-6 text-xs text-gray-400">
        Started: {new Date(s.started_at).toLocaleString()}
        {s.finalized_at && (
          <> · Finished: {new Date(s.finalized_at).toLocaleString()}</>
        )}
      </p>
    </main>
  );
}

// ── Outer page (unwraps async params) ─────────────────────────────────────────

interface StudyStatusPageProps {
  // Next.js 14 App Router: params can be a Promise<{id: string}> or {id: string}.
  params: Promise<{ id: string }> | { id: string };
}

export default function StudyStatusPage({ params }: StudyStatusPageProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(null);

  useEffect(() => {
    // Resolve params whether it's a Promise or a plain object.
    if (params instanceof Promise) {
      void params.then(({ id }) => setResolvedId(id));
    } else {
      setResolvedId(params.id);
    }
  }, [params]);

  if (!resolvedId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  return <StudyStatusInner id={resolvedId} />;
}
