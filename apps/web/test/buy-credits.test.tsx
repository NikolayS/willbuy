/**
 * buy-credits.test.tsx — TDD acceptance for issue #73.
 *
 * Asserts that BuyCredits renders the correct visit-estimate copy derived
 * from pack.cents / 5 (spec §5.5 per-visit cost ceiling).
 *
 * Expected:
 *   Starter:  2900¢ / 5¢ = 580 visits
 *   Growth:   9900¢ / 5¢ = 1980 visits
 *   Scale:   29900¢ / 5¢ = 5980 visits
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuyCredits } from '../components/credits/BuyCredits';

describe('BuyCredits visit-estimate copy (issue #73)', () => {
  function renderComponent() {
    render(
      <BuyCredits
        apiKey="sk_test_fake"
        apiBaseUrl="https://api.example.com"
      />,
    );
  }

  it('starter pack shows "580 visits"', () => {
    renderComponent();
    expect(screen.getByText(/580 visits/i)).toBeTruthy();
  });

  it('growth pack shows "1980 visits"', () => {
    renderComponent();
    expect(screen.getByText(/1,?980 visits/i)).toBeTruthy();
  });

  it('scale pack shows "5980 visits"', () => {
    renderComponent();
    expect(screen.getByText(/5,?980 visits/i)).toBeTruthy();
  });
});
