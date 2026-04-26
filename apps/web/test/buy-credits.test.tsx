/**
 * buy-credits.test.tsx — TDD acceptance for issue #73.
 *
 * Asserts that BuyCredits renders the correct visit-estimate copy derived
 * from Math.floor(pack.cents / 3.5) — issue #112 manager decision: use
 * 3.5¢/visit average cost (not the 5¢ ceiling) for consistency with /pricing.
 *
 * Expected:
 *   Starter:  Math.floor(2900 / 3.5)  = 828 visits
 *   Growth:   Math.floor(9900 / 3.5)  = 2828 visits
 *   Scale:    Math.floor(29900 / 3.5) = 8542 visits
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BuyCredits } from '../components/credits/BuyCredits';

afterEach(() => {
  cleanup();
});

describe('BuyCredits visit-estimate copy (issue #73, updated #112)', () => {
  function renderComponent() {
    render(
      <BuyCredits
        apiKey="sk_test_fake"
        apiBaseUrl="https://api.example.com"
      />,
    );
  }

  it('starter pack shows "828 visits" (3.5¢ avg per #112)', () => {
    renderComponent();
    // Use getAllByText to handle locale-formatted numbers; assert at least one match.
    expect(screen.getAllByText(/828 visits/i).length).toBeGreaterThan(0);
  });

  it('growth pack shows "2828 visits" (3.5¢ avg per #112)', () => {
    renderComponent();
    expect(screen.getAllByText(/2[,.]?828 visits/i).length).toBeGreaterThan(0);
  });

  it('scale pack shows "8542 visits" (3.5¢ avg per #112)', () => {
    renderComponent();
    expect(screen.getAllByText(/8[,.]?542 visits/i).length).toBeGreaterThan(0);
  });
});
