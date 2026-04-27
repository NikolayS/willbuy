// @vitest-environment jsdom
//
// Spec §3d (docs/launch/pricing-cta-audit.md) — buy CTA footer bar on /r/* pages.
// Issue #146.
//
// Acceptance criteria:
//   1. The CTA bar renders in the report page output.
//   2. The CTA link points to /pricing.
//   3. No email-capture form is present.
//   4. The close / dismiss button is present.
//   5. Clicking dismiss hides the bar.
//   6. Pre-dismissed localStorage state hides bar on mount.
//   7. localStorage unavailability (getItem throws) does not crash.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReportCtaBar } from '../components/report/ReportCtaBar';

// jsdom in this project's Bun/Vitest config launches without a localStorage
// file path, which leaves window.localStorage as a non-functional stub.
// Install a minimal in-memory shim so the useEffect inside ReportCtaBar
// doesn't throw and doesn't incorrectly set dismissed=true.
beforeAll(() => {
  const store: Record<string, string> = {};
  const stub = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', { value: stub, writable: false });
});

afterEach(() => {
  cleanup();
  // Reset the localStorage shim between tests so dismiss state doesn't bleed.
  window.localStorage.clear();
});

describe('§3d — report CTA bar (#146)', () => {
  it('1. renders the CTA bar', () => {
    render(<ReportCtaBar />);
    expect(screen.getByTestId('report-cta-bar')).toBeTruthy();
  });

  it('2. CTA link points to /pricing', () => {
    render(<ReportCtaBar />);
    const link = screen.getByRole('link', { name: /run a study/i });
    expect(link.getAttribute('href')).toBe('/pricing');
  });

  it('3. no email-capture form in the CTA bar', () => {
    const { container } = render(<ReportCtaBar />);
    // No <form> element, no email input.
    expect(container.querySelectorAll('form').length).toBe(0);
    expect(container.querySelectorAll('input[type="email"]').length).toBe(0);
    expect(container.querySelectorAll('input[type="text"]').length).toBe(0);
  });

  it('4. dismiss/close button is present', () => {
    render(<ReportCtaBar />);
    // Accept aria-label or visible text containing dismiss, close, or ×.
    const btn =
      screen.queryByRole('button', { name: /dismiss|close|×/i }) ??
      screen.queryByLabelText(/dismiss|close|×/i);
    expect(btn).toBeTruthy();
  });

  it('5. clicking dismiss hides the bar and writes localStorage key', async () => {
    render(<ReportCtaBar />);
    expect(screen.getByTestId('report-cta-bar')).toBeTruthy();

    const btn =
      screen.getByRole('button', { name: /dismiss|close|×/i }) ??
      screen.getByLabelText(/dismiss|close|×/i);

    await act(async () => { fireEvent.click(btn); });

    expect(screen.queryByTestId('report-cta-bar')).toBeNull();
    expect(window.localStorage.getItem('willbuy_report_cta_dismissed')).toBe('1');
  });

  it('6. pre-dismissed localStorage → bar is hidden on mount', async () => {
    window.localStorage.setItem('willbuy_report_cta_dismissed', '1');
    render(<ReportCtaBar />);

    // The useEffect fires asynchronously after mount, so wait a tick.
    await act(async () => {});

    expect(screen.queryByTestId('report-cta-bar')).toBeNull();
  });

  it('7. localStorage.getItem throwing does not crash the bar', async () => {
    const original = window.localStorage.getItem.bind(window.localStorage);
    // Temporarily replace getItem with a throwing stub.
    (window.localStorage as { getItem: (k: string) => string | null }).getItem = () => {
      throw new Error('security error: localStorage unavailable');
    };

    // Should render without throwing.
    render(<ReportCtaBar />);
    await act(async () => {});
    expect(screen.getByTestId('report-cta-bar')).toBeTruthy();

    // Restore.
    (window.localStorage as { getItem: (k: string) => string | null }).getItem = original;
  });
});
