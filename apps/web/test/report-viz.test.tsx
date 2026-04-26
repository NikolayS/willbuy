// Spec §5.18 — report visualization. The 7 elements must each render
// against a fixture that matches the aggregator's wire shape (#31).
//
// This file is intentionally thin: each `it()` is one of the five named
// scenarios from issue #35 ("TDD acceptance"). The components live in
// apps/web/components/report/* and are imported through a single
// `<ReportView />` entrypoint.
//
// Test environment: jsdom (Recharts uses ResizeObserver + getBBox). We
// stub them at the top — Recharts respects width/height props when the
// ResponsiveContainer parent reports zero, so charts still render.

// @vitest-environment jsdom

import { act } from 'react';
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { Report, type ReportT } from '@willbuy/shared/report';
import fixtureJson from './fixtures/report.fixture.json';
import disagreementJson from './fixtures/report.disagreement.fixture.json';
import { ReportView } from '../components/report/ReportView';
import { PairedDots } from '../components/report/PairedDots';
import { exportElementToPng } from '../lib/png-export';

// Recharts uses ResizeObserver + element.getBoundingClientRect; jsdom
// provides the latter as zeroes. Stub ResizeObserver and patch
// getBoundingClientRect so chart children get a non-zero box and render
// SVG elements we can assert on.
beforeAll(() => {
  class ROStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ROStub }).ResizeObserver = ROStub;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };
    },
  });
  // Recharts' SVG path measurement calls getBBox — jsdom doesn't have it.
  (
    SVGElement.prototype as unknown as { getBBox?: () => DOMRect }
  ).getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 } as DOMRect);
});

const fixture = Report.parse(fixtureJson) satisfies ReportT;
const disagreementFixture = Report.parse(disagreementJson) satisfies ReportT;

// React Testing Library mounts into document.body and does NOT auto-clean
// between tests when used in vitest without the auto-cleanup hook (we
// don't import @testing-library/jest-dom). Manual cleanup keeps each
// `it` independent — otherwise testid lookups across tests fail with
// "Found multiple elements".
afterEach(() => {
  cleanup();
});

describe('§5.18 — report visualization', () => {
  it('1. all 7 elements render with the fixture report payload', () => {
    render(<ReportView report={fixture} mode="dashboard" />);
    // Element 1: headline delta. Mean delta + verdict copy.
    expect(screen.getByTestId('headline-delta')).toBeTruthy();
    // Element 2: paired-delta dot plot.
    expect(screen.getByTestId('paired-dots')).toBeTruthy();
    // Element 3: will-to-buy histograms (one per variant).
    expect(screen.getByTestId('histogram-A')).toBeTruthy();
    expect(screen.getByTestId('histogram-B')).toBeTruthy();
    // Element 4: next-action stacked bar.
    expect(screen.getByTestId('next-actions')).toBeTruthy();
    // Element 5: tier-picked distribution.
    expect(screen.getByTestId('tier-picked')).toBeTruthy();
    // Element 6: theme board (4 categories).
    const board = screen.getByTestId('theme-board');
    expect(within(board).getByTestId('theme-blockers')).toBeTruthy();
    expect(within(board).getByTestId('theme-objections')).toBeTruthy();
    expect(within(board).getByTestId('theme-confusions')).toBeTruthy();
    expect(within(board).getByTestId('theme-questions')).toBeTruthy();
    // Element 7: persona cards grid.
    expect(screen.getByTestId('persona-grid')).toBeTruthy();
  });

  it('2. disagreement banner shows when paired-t and Wilcoxon disagree (§2 #19)', () => {
    render(<ReportView report={disagreementFixture} mode="dashboard" />);
    const banner = screen.getByTestId('disagreement-banner');
    // Spec §2 #19: copy must label the conclusion as "weak — tests disagree"
    // and surface the more conservative (larger) p-value.
    expect(banner.textContent).toMatch(/weak.*tests disagree/i);
    // The conservative p in the disagreement fixture is 0.092 (Wilcoxon).
    expect(banner.textContent).toMatch(/0\.092/);

    // Negative case: the happy-path fixture has agreement and shows no banner.
    cleanup();
    render(<ReportView report={fixture} mode="dashboard" />);
    expect(screen.queryByTestId('disagreement-banner')).toBeNull();
  });

  it('3. CSP §5.10: no inline <script> emitted by any rendered component', () => {
    // Recharts ships SVG, no inline scripts. We assert by scanning the
    // rendered DOM for <script> elements; any inline script would mean
    // a regression of §5.10 on /r/* (where this view is hydrated).
    const { container } = render(<ReportView report={fixture} mode="public" />);
    const scripts = container.querySelectorAll('script');
    expect(scripts.length).toBe(0);
    // Defense in depth: no element should carry an inline event handler.
    const onclickAttrs = container.querySelectorAll('[onclick]');
    expect(onclickAttrs.length).toBe(0);
  });

  it('4. PNG export produces a non-empty data URL', async () => {
    // The export covers element 1 (headline) + element 2 (paired-delta
    // dot plot) per §5.18 export+share. The lib mocks out the actual
    // canvas serialization in jsdom — what we verify here is the
    // contract: it returns a non-empty `data:image/png;base64,...` URL.
    const stubCanvasFn = vi.fn(async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA');
    const url = await exportElementToPng(document.createElement('div'), {
      _toPngForTest: stubCanvasFn,
    });
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan('data:image/png;base64,'.length);
    expect(stubCanvasFn).toHaveBeenCalledTimes(1);
  });

  it('5. clicking a persona card opens the drawer with both A and B verdicts', () => {
    render(<ReportView report={fixture} mode="dashboard" />);
    const grid = screen.getByTestId('persona-grid');
    const cards = within(grid).getAllByTestId(/^persona-card-/);
    expect(cards.length).toBeGreaterThan(0);
    // The grid is sorted by |score_b - score_a| desc; the top card is the
    // largest swing. In the fixture that's bs-005 (score_a=2, score_b=6).
    expect(cards[0]?.getAttribute('data-backstory-id')).toBe('bs-005');
    fireEvent.click(cards[0]!);
    const drawer = screen.getByTestId('persona-drawer');
    // Both verdicts must be present side-by-side per §5.18 #7.
    const verdictA = within(drawer).getByTestId('drawer-verdict-A');
    const verdictB = within(drawer).getByTestId('drawer-verdict-B');
    expect(verdictA.textContent).toMatch(/bounce/i);
    expect(verdictB.textContent).toMatch(/paid trial/i);
  });

  it('public-mode hides debug UI per §5.18 export+share', () => {
    // /r/:slug renders the same page WITHOUT the debug view. We tag a
    // single debug element and assert the public mode strips it; this
    // matches spec §5.18 ("the same page read-only ... WITHOUT the debug
    // view") without committing to an exhaustive debug-component list.
    const { queryByTestId, rerender } = render(
      <ReportView report={fixture} mode="dashboard" />,
    );
    expect(queryByTestId('debug-panel')).not.toBeNull();
    rerender(<ReportView report={fixture} mode="public" />);
    expect(queryByTestId('debug-panel')).toBeNull();
  });

  it('low-power banner shows when meta.low_power is true (spec §9)', () => {
    const lowPowerFixture: ReportT = {
      ...fixture,
      meta: { ...fixture.meta, low_power: true },
    };
    render(<ReportView report={lowPowerFixture} mode="dashboard" />);
    const banner = screen.getByTestId('low-power-banner');
    expect(banner.textContent).toMatch(/low.power/i);
  });

  it('F2 — charts render SVG content even when parent getBoundingClientRect returns 0 height (issue #78)', () => {
    // Regression guard for the "empty chart on initial paint" bug (#78).
    //
    // Root cause: ResponsiveContainer with height="100%" measures its parent
    // via ResizeObserver/getBoundingClientRect. On first paint in a Next.js
    // SSR context the CSS hasn't applied yet, so the measured height is 0 —
    // Recharts emits an SVG with height=0 and nothing is visible.
    //
    // The fix is to pass explicit pixel heights instead of "100%". This test
    // verifies the fix by rendering each chart component with a parent whose
    // getBoundingClientRect returns height=0, then asserting that the SVG
    // element has a non-zero height attribute (meaning Recharts used the
    // hard-coded prop, not the measured parent size).
    //
    // If any component still uses height="100%", its SVG will render with
    // height=0 (or Recharts will skip rendering entirely) and this test fails.
    const origGBCR = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return { width: 800, height: 0, top: 0, left: 0, right: 800, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
      },
    });

    try {
      // PairedDots — container uses h-64 = 256px
      {
        const { container } = render(<PairedDots rows={fixture.paired_dots} />);
        const svgs = container.querySelectorAll('svg');
        expect(svgs.length, 'PairedDots: expected at least one SVG element').toBeGreaterThan(0);
        const svgHeight = Number(svgs[0]?.getAttribute('height') ?? 0);
        expect(svgHeight, 'PairedDots: SVG height must be > 0 (not measured from zero-height parent)').toBeGreaterThan(0);
        cleanup();
      }

      // Histograms — container uses h-48 = 192px per histogram
      {
        const { container } = render(<ReportView report={fixture} mode="public" />);
        const histA = container.querySelector('[data-testid="histogram-A"] svg');
        const histB = container.querySelector('[data-testid="histogram-B"] svg');
        expect(histA, 'Histograms: histogram-A SVG must exist').toBeTruthy();
        expect(histB, 'Histograms: histogram-B SVG must exist').toBeTruthy();
        expect(
          Number(histA?.getAttribute('height') ?? 0),
          'Histograms: histogram-A SVG height must be > 0',
        ).toBeGreaterThan(0);
        expect(
          Number(histB?.getAttribute('height') ?? 0),
          'Histograms: histogram-B SVG height must be > 0',
        ).toBeGreaterThan(0);
        // NextActions — h-72 = 288px
        const nextActions = container.querySelector('[data-testid="next-actions"] svg');
        expect(nextActions, 'NextActions: SVG must exist').toBeTruthy();
        expect(
          Number(nextActions?.getAttribute('height') ?? 0),
          'NextActions: SVG height must be > 0',
        ).toBeGreaterThan(0);
        // TierPicked — h-48 = 192px
        const tierPicked = container.querySelector('[data-testid="tier-picked"] svg');
        expect(tierPicked, 'TierPicked: SVG must exist').toBeTruthy();
        expect(
          Number(tierPicked?.getAttribute('height') ?? 0),
          'TierPicked: SVG height must be > 0',
        ).toBeGreaterThan(0);
        // ThemeBoard — h-40 = 160px per category chart
        const themeBlockers = container.querySelector('[data-testid="theme-blockers"] svg');
        expect(themeBlockers, 'ThemeBoard/blockers: SVG must exist').toBeTruthy();
        expect(
          Number(themeBlockers?.getAttribute('height') ?? 0),
          'ThemeBoard/blockers: SVG height must be > 0',
        ).toBeGreaterThan(0);
        cleanup();
      }
    } finally {
      // Restore original getBoundingClientRect so subsequent tests are unaffected.
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: origGBCR,
      });
    }
  });

  it('issue #133 smoke — report fixture renders Recharts SVGs (CSP A8 regression)', async () => {
    // Regression guard for issue #133: with the strict `style-src 'self'`
    // CSP from PR #13, Recharts' ResponsiveContainer emits inline
    // style="width:..;height:.." that the browser silently rejects, the
    // measured container height collapses to 0, and Recharts draws no
    // SVG. The fix is amendment A8 (`style-src 'self' 'unsafe-inline'`).
    //
    // Note: jsdom does not enforce CSP — this test cannot reproduce the
    // browser's silent rejection. What it CAN guarantee is the
    // end-to-end DOM shape: rendering the full report fixture must yield
    // > 0 SVG elements. The CSP-string contract itself is asserted in
    // apps/web/test/middleware.test.ts (also added in this PR).
    const { container } = render(<ReportView report={fixture} mode="public" />);
    // Flush effects so Recharts' ResizeObserver-driven layout completes.
    await act(async () => {
      await Promise.resolve();
    });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length, 'expected ReportView to render at least one Recharts SVG').toBeGreaterThan(0);
  });

  it('single-variant report (score_b=null, 1 histogram) renders without crashing', async () => {
    // Regression guard for the dogfood single-variant path: score_b nullable
    // and histograms/next_actions/tier_picked arrays have length 1. The Zod
    // schema was relaxed from .length(2) to .min(1).max(2) in PR #171.
    const singleVariant: ReportT = {
      ...fixture,
      histograms: [fixture.histograms[0]!],
      next_actions: [fixture.next_actions[0]!],
      tier_picked: [fixture.tier_picked[0]!],
      paired_dots: [],
      personas: fixture.personas.slice(0, 2).map((p) => ({
        ...p,
        score_b: null,
        verdict_b: null,
      })),
    };
    // Must not throw during parse.
    const parsed = Report.parse(singleVariant);
    expect(parsed.histograms).toHaveLength(1);
    expect(parsed.personas[0]?.score_b).toBeNull();
    // Must not throw during render.
    const { container } = render(<ReportView report={parsed} mode="public" />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelectorAll('[data-testid="persona-grid"]').length).toBe(1);
  });

  it('F1 — paired-dot plot renders one SVG <line> connector per backstory (§5.18 #2)', () => {
    // Spec §5.18 #2: "Per-visitor dots showing A-score vs B-score with a
    // thin connecting segment." The connector is the entire point of the
    // paired-dot design — without it the viewer sees two disconnected
    // scatter fields that don't make the per-backstory pairing legible.
    //
    // We render PairedDots directly with the fixture's paired_dots rows
    // and assert that the DOM contains one <line> element per backstory.
    const { container } = render(<PairedDots rows={fixture.paired_dots} />);
    const lines = container.querySelectorAll('line[data-connector]');
    // One connector line per backstory row.
    expect(lines.length).toBe(fixture.paired_dots.length);
    // Each line should carry the swing class for its coloring.
    for (const line of lines) {
      expect(line.getAttribute('stroke')).toBeTruthy();
    }
  });
});
