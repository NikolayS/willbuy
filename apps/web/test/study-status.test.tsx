/**
 * study-status.test.tsx — TDD acceptance for issue #111 (CSP-safe progress bar).
 *
 * Spec refs:
 *   §5.10 — CSP: no inline scripts/styles. The middleware's `style-src` does
 *           NOT allow `'unsafe-inline'`, so any `style="..."` attribute on the
 *           rendered output would be blocked at runtime.
 *
 * Sprint 3 retro audit found that /dashboard/studies/[id] used inline
 * `style={{ width: ... }}` on the visit-progress bar. This suite locks in:
 *
 *   1. The pure `progressClass` helper rounds to the nearest twelfth and
 *      maps to a fixed-set Tailwind width class.
 *   2. `<ProgressBar/>`'s rendered HTML uses the right `w-N/M` class for
 *      various fixture progress values.
 *   3. `<ProgressBar/>`'s rendered HTML contains NO `style=` attribute, so
 *      the page is CSP-clean under `style-src 'self'`.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ProgressBar,
  progressClass,
  PROGRESS_CLASSES,
} from '../app/dashboard/studies/[id]/page';

describe('progressClass helper (issue #111)', () => {
  it('maps 0% to w-0', () => {
    expect(progressClass(0)).toBe('w-0');
  });

  it('maps 100% to w-full', () => {
    expect(progressClass(100)).toBe('w-full');
  });

  it('maps 50% to w-1/2', () => {
    expect(progressClass(50)).toBe('w-1/2');
  });

  it('maps 25% to w-1/4', () => {
    // 25% / (100/12) = 3.0 → idx 3 → 'w-1/4'
    expect(progressClass(25)).toBe('w-1/4');
  });

  it('maps 75% to w-3/4', () => {
    // 75% / (100/12) = 9.0 → idx 9 → 'w-3/4'
    expect(progressClass(75)).toBe('w-3/4');
  });

  it('rounds to the nearest twelfth (70% → w-2/3)', () => {
    // 70% / (100/12) = 8.4 → round → idx 8 → 'w-2/3' (~66.67%).
    expect(progressClass(70)).toBe('w-2/3');
  });

  it('clamps negative values to w-0', () => {
    expect(progressClass(-10)).toBe('w-0');
  });

  it('clamps values above 100 to w-full', () => {
    expect(progressClass(150)).toBe('w-full');
  });

  it('always returns a class from the safelist (no JIT drops)', () => {
    for (let pct = -5; pct <= 105; pct += 1) {
      expect(PROGRESS_CLASSES).toContain(progressClass(pct) as never);
    }
  });
});

describe('<ProgressBar/> rendered HTML (issue #111)', () => {
  it('renders the right Tailwind width class for a 70%/10% split', () => {
    const html = renderToStaticMarkup(
      <ProgressBar ok={7} failed={1} total={10} />,
    );
    // 70% → nearest twelfth → w-2/3.   10% → nearest twelfth → w-1/12.
    expect(html).toContain('w-2/3');
    expect(html).toContain('w-1/12');
    // Sanity: original Tailwind utility classes are still there.
    expect(html).toContain('bg-green-500');
    expect(html).toContain('bg-red-400');
    // Status text rendered.
    expect(html).toContain('7 / 10 visitors complete (1 failed)');
    expect(html).toContain('70%');
  });

  it('renders w-full for a fully-complete study', () => {
    const html = renderToStaticMarkup(
      <ProgressBar ok={30} failed={0} total={30} />,
    );
    expect(html).toContain('w-full');
    expect(html).toContain('30 / 30 visitors complete');
    // No "failed" annotation when failed=0.
    expect(html).not.toContain('failed)');
  });

  it('renders w-0 for a zero-progress study', () => {
    const html = renderToStaticMarkup(
      <ProgressBar ok={0} failed={0} total={20} />,
    );
    expect(html).toContain('w-0');
    expect(html).toContain('0 / 20 visitors complete');
  });

  it('returns null when total is zero (no bar to draw)', () => {
    const html = renderToStaticMarkup(
      <ProgressBar ok={0} failed={0} total={0} />,
    );
    expect(html).toBe('');
  });

  // -------------------------------------------------------------------------
  // The CSP-compliance assertion. This is the regression test for #111.
  // -------------------------------------------------------------------------
  it('emits NO inline style attribute (CSP §5.10 — no `unsafe-inline`)', () => {
    const fixtures = [
      { ok: 0, failed: 0, total: 10 },
      { ok: 1, failed: 0, total: 10 },
      { ok: 5, failed: 1, total: 10 },
      { ok: 7, failed: 3, total: 10 },
      { ok: 10, failed: 0, total: 10 },
      { ok: 100, failed: 50, total: 200 },
    ];
    for (const f of fixtures) {
      const html = renderToStaticMarkup(<ProgressBar {...f} />);
      // The exact failure mode of the pre-fix code: a `style="width:..."` attr.
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toContain('width:');
    }
  });
});
