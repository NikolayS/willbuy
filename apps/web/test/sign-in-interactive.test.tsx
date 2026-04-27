// @vitest-environment jsdom
//
// Interactive tests for the /sign-in page (app/sign-in/page.tsx).
// The existing sign-in.test.tsx uses renderToStaticMarkup / source inspection.
// This file uses @testing-library/react to test the interactive behaviors:
//   - Submitting with an empty email shows a client-side error
//   - Submitting with a valid email calls POST /api/auth/magic-link
//   - Successful response shows "Check your email" state
//   - API error shows an error message
//
// Spec refs: §5.10 (CSP — no inline scripts), §4.1 (stack), issue #79.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('/sign-in interactive behavior', () => {
  it('shows "Please enter your email address" when submitting empty', async () => {
    const { default: SignInPage } = await import('../app/sign-in/page');
    render(React.createElement(SignInPage));
    const submit = screen.getByRole('button', { name: /send sign-in link/i });
    await act(async () => { fireEvent.click(submit); });
    expect(screen.getByRole('alert').textContent).toMatch(/please enter your email address/i);
  });

  it('POSTs to /api/auth/magic-link with email and shows success state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { default: SignInPage } = await import('../app/sign-in/page');
    render(React.createElement(SignInPage));

    const input = screen.getByRole('textbox', { name: /email/i });
    fireEvent.change(input, { target: { value: 'user@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    });

    await waitFor(() =>
      expect(screen.queryByText(/check your email/i)).not.toBeNull(),
    );

    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/magic-link',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((opts as RequestInit).body as string) as { email: string };
    expect(body.email).toBe('user@example.com');
  });

  it('shows error message when API returns non-202', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { default: SignInPage } = await import('../app/sign-in/page');
    render(React.createElement(SignInPage));

    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'user@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    });

    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeNull(),
    );
    // Must not show success state.
    expect(screen.queryByText(/check your email/i)).toBeNull();
  });

  it('button shows "Sending…" while in flight', async () => {
    let resolve!: (r: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((res) => { resolve = res; }),
    );

    const { default: SignInPage } = await import('../app/sign-in/page');
    render(React.createElement(SignInPage));

    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'user@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    });

    await waitFor(() =>
      expect(screen.queryByText(/sending/i)).not.toBeNull(),
    );

    // Resolve the request to clean up.
    resolve(new Response('{}', { status: 202 }));
    await waitFor(() => expect(screen.queryByText(/check your email/i)).not.toBeNull());
  });
});
