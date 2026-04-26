'use client';

// Spec §3d (docs/launch/pricing-cta-audit.md) — buy CTA footer bar for
// /r/* public report pages. Issue #146.
//
// Design constraints:
//   - Fixed to viewport bottom, low-profile strip (not a modal).
//   - Dismissible via localStorage key `willbuy_report_cta_dismissed=1`.
//   - SSR renders the bar visible; client hydration manages dismiss state.
//   - No inline <script> tags — localStorage access is inside event handlers,
//     which is fine under the existing nonce-based CSP (§5.10 / middleware.ts).

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'willbuy_report_cta_dismissed';

export function ReportCtaBar() {
  // Initialise as visible so the SSR HTML always includes the bar.
  // After hydration, check localStorage and hide if already dismissed.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1') {
        setDismissed(true);
      }
    } catch {
      // localStorage may be unavailable (private browsing, security policies).
    }
  }, []);

  if (dismissed) return null;

  function handleDismiss() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, '1');
      }
    } catch {
      // localStorage may be unavailable (private browsing, security policies).
    }
    setDismissed(true);
  }

  return (
    <div
      data-testid="report-cta-bar"
      className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-between gap-4 bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <a
        href="/pricing"
        className="font-medium hover:underline focus-visible:underline"
      >
        Run a study on your own page →
      </a>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className="flex-shrink-0 rounded p-1 text-gray-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        ×
      </button>
    </div>
  );
}
