// @vitest-environment jsdom
//
// TDD acceptance tests for BuyButton (app/dashboard/credits/BuyButton.tsx).
//
// The component has three observable states:
//   1. Idle      — "Buy →" button enabled
//   2. Loading   — "Redirecting…" button disabled while awaiting checkout URL
//   3. Error     — error message shown, button re-enabled after failure
//
// On success the component calls window.location.href = <stripe-url>.
// We stub window.location via vi.stubGlobal so we can assert the redirect
// without jsdom throwing on real navigation.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BuyButton } from '../app/dashboard/credits/BuyButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BuyButton', () => {
  it('renders "Buy →" button with correct aria-label', () => {
    render(<BuyButton packId="starter" label="Starter" usd={29} />);
    const btn = screen.getByRole('button', { name: /buy starter pack/i });
    expect(btn).toBeTruthy();
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('redirects to Stripe checkout URL on 200 response', async () => {
    const locationStub = { href: '' };
    vi.stubGlobal('location', locationStub);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test_stub' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<BuyButton packId="growth" label="Growth" usd={99} />);
    fireEvent.click(screen.getByRole('button', { name: /buy growth pack/i }));

    await waitFor(() =>
      expect(locationStub.href).toBe('https://checkout.stripe.com/pay/cs_test_stub'),
    );

    expect(fetch).toHaveBeenCalledWith('/api/checkout/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack_id: 'growth' }),
    });
  });

  it('shows error from JSON body on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'payment provider unavailable' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<BuyButton packId="scale" label="Scale" usd={299} />);
    fireEvent.click(screen.getByRole('button', { name: /buy scale pack/i }));

    await waitFor(() =>
      expect(screen.queryByText(/payment provider unavailable/i)).not.toBeNull(),
    );

    // Button must be re-enabled for retry.
    expect(screen.getByRole('button', { name: /buy scale pack/i }).hasAttribute('disabled')).toBe(false);
  });

  it('shows generic error on non-JSON error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    render(<BuyButton packId="starter" label="Starter" usd={29} />);
    fireEvent.click(screen.getByRole('button', { name: /buy starter pack/i }));

    await waitFor(() =>
      expect(screen.queryByText(/payment provider unavailable/i)).not.toBeNull(),
    );
  });

  it('shows "network error" on fetch rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<BuyButton packId="starter" label="Starter" usd={29} />);
    fireEvent.click(screen.getByRole('button', { name: /buy starter pack/i }));

    await waitFor(() =>
      expect(screen.queryByText(/network error/i)).not.toBeNull(),
    );
  });

  it('button is disabled and shows "Redirecting…" while in-flight', async () => {
    let resolveResponse!: (r: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveResponse = resolve; }),
    );

    const locationStub = { href: '' };
    vi.stubGlobal('location', locationStub);

    render(<BuyButton packId="starter" label="Starter" usd={29} />);
    fireEvent.click(screen.getByRole('button', { name: /buy starter pack/i }));

    // The aria-label stays constant; check for "Redirecting…" text content and disabled attr.
    await waitFor(() => {
      const btn = screen.getByText(/redirecting/i);
      expect(btn.closest('button')?.hasAttribute('disabled')).toBe(true);
    });

    // Resolve so the component settles cleanly.
    resolveResponse(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/done' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await waitFor(() => expect(locationStub.href).toContain('checkout.stripe.com'));
  });
});
