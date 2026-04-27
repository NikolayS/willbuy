// @vitest-environment jsdom
//
// Interactive tests for BuyCredits (components/credits/BuyCredits.tsx).
// The existing buy-credits.test.tsx only verifies visit-estimate copy.
// This file tests the pack selection + checkout flow:
//   - Clicking a pack selects it (visual feedback)
//   - Clicking "Buy credits" POSTs with selected pack_id to apiBaseUrl
//   - Success → window.location.href set to Stripe URL
//   - Error → error message shown

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BuyCredits } from '../components/credits/BuyCredits';

const API_KEY = 'sk_live_test';
const API_BASE = 'https://api.test.willbuy.dev';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BuyCredits — interaction', () => {
  it('renders "Buy credits" button and all three packs', () => {
    render(<BuyCredits apiKey={API_KEY} apiBaseUrl={API_BASE} />);
    expect(screen.getByRole('button', { name: /buy credits/i })).toBeTruthy();
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Growth')).toBeTruthy();
    expect(screen.getByText('Scale')).toBeTruthy();
  });

  it('POSTs to apiBaseUrl/checkout/sessions with selected pack_id on click', async () => {
    const locationStub = { href: '' };
    vi.stubGlobal('location', locationStub);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<BuyCredits apiKey={API_KEY} apiBaseUrl={API_BASE} />);

    // Click "Growth" pack to select it.
    fireEvent.click(screen.getByText('Growth'));
    // Click "Buy credits".
    fireEvent.click(screen.getByRole('button', { name: /buy credits/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${API_BASE}/checkout/sessions`);
    expect((opts as RequestInit).method).toBe('POST');
    const body = JSON.parse((opts as RequestInit).body as string) as { pack_id: string };
    expect(body.pack_id).toBe('growth');

    await waitFor(() => expect(locationStub.href).toContain('checkout.stripe.com'));
  });

  it('shows error message when API returns non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<BuyCredits apiKey={API_KEY} apiBaseUrl={API_BASE} />);
    fireEvent.click(screen.getByRole('button', { name: /buy credits/i }));

    await waitFor(() =>
      expect(screen.queryByText(/rate limited/i)).not.toBeNull(),
    );
    // Button must still be present for retry.
    expect(screen.getByRole('button', { name: /buy credits/i })).toBeTruthy();
  });

  it('starter is selected by default (first pack_id submitted is starter)', async () => {
    const locationStub = { href: '' };
    vi.stubGlobal('location', locationStub);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<BuyCredits apiKey={API_KEY} apiBaseUrl={API_BASE} />);
    // Don't click any pack — submit with default selection.
    fireEvent.click(screen.getByRole('button', { name: /buy credits/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, opts] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((opts as RequestInit).body as string) as { pack_id: string };
    expect(body.pack_id).toBe('starter');
  });
});
