// @vitest-environment jsdom
//
// Spec §3d (docs/launch/pricing-cta-audit.md) — buy CTA footer bar on /r/* pages.
// Issue #146.
//
// These four assertions match the acceptance criteria in the issue:
//   1. The CTA bar renders in the report page output.
//   2. The CTA link points to /pricing.
//   3. No email-capture form is present.
//   4. The close / dismiss button is present.
//
// The dismiss interaction itself (localStorage writes) is intentionally
// not tested here — it's a one-liner and JSDOM quirks make it fragile.
// Presence of the button is sufficient per the issue spec.

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReportCtaBar } from '../components/report/ReportCtaBar';

afterEach(() => {
  cleanup();
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
});
