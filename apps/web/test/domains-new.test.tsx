// @vitest-environment jsdom
//
// TDD acceptance tests for issue #82 (domain verification flow).
//
// Component under test: apps/web/app/dashboard/domains/new/page.tsx
//
// Spec refs: §2 #1 (verified-domain authorization), §4.1 (web app),
//            §5.10 (no inline scripts; CSP).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Stub Next.js router (App Router) — the page calls router.push() on success.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Form renders and submits POST /api/domains
// ─────────────────────────────────────────────────────────────────────────────
describe('DomainsNewPage — form submit', () => {
  it('renders a domain input + submit button and POSTs to /api/domains on submit', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            domain: 'example.com',
            verify_token: 'abcdefghijklmnopqrstuv',
            methods: {
              dns: 'TXT willbuy-verify=abcdefghijklmnopqrstuv',
              well_known: 'GET /.well-known/willbuy-verify returns abcdefghijklmnopqrstuv',
              meta: '<meta name="willbuy-verify" content="abcdefghijklmnopqrstuv">',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const { default: DomainsNewPage } = await import(
      '../app/dashboard/domains/new/page'
    );
    render(React.createElement(DomainsNewPage));

    // Domain input present.
    const input = screen.getByRole('textbox', { name: /domain/i });
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: 'example.com' } });

    const submit = screen.getByRole('button', { name: /continue/i });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/domains$/);
    expect((opts as RequestInit).method).toBe('POST');
    const body = JSON.parse((opts as RequestInit).body as string) as { domain: string };
    expect(body.domain).toBe('example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Instructions render with the token after a successful POST
// ─────────────────────────────────────────────────────────────────────────────
describe('DomainsNewPage — instructions render', () => {
  it('shows the three verification methods (DNS / well-known / meta) with the verify_token', async () => {
    const token = 'abcdefghijklmnopqrstuv';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          domain: 'example.com',
          verify_token: token,
          methods: {
            dns: `TXT willbuy-verify=${token}`,
            well_known: `GET /.well-known/willbuy-verify returns ${token}`,
            meta: `<meta name="willbuy-verify" content="${token}">`,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { default: DomainsNewPage } = await import(
      '../app/dashboard/domains/new/page'
    );
    render(React.createElement(DomainsNewPage));

    fireEvent.change(screen.getByRole('textbox', { name: /domain/i }), {
      target: { value: 'example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    });

    // DNS TXT panel.
    await waitFor(() =>
      expect(screen.getAllByText(/TXT/i).length).toBeGreaterThan(0),
    );
    // The token appears in all three rendered options (with the text broken
    // up across nodes). At minimum it must be visible somewhere on the page.
    expect(document.body.textContent).toContain(token);
    // /.well-known is mentioned.
    expect(document.body.textContent).toContain('/.well-known/willbuy-verify');
    // meta tag is mentioned.
    expect(document.body.textContent).toContain('willbuy-verify');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Verify-now button POSTs to /api/domains/<domain>/verify
// ─────────────────────────────────────────────────────────────────────────────
describe('DomainsNewPage — verify-now action', () => {
  it('clicking "Verify now" calls POST /api/domains/<domain>/verify', async () => {
    const token = 'abcdefghijklmnopqrstuv';

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domain: 'example.com',
            verify_token: token,
            methods: {
              dns: `TXT willbuy-verify=${token}`,
              well_known: `GET /.well-known/willbuy-verify returns ${token}`,
              meta: `<meta name="willbuy-verify" content="${token}">`,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ verified: true, method: 'dns' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const { default: DomainsNewPage } = await import(
      '../app/dashboard/domains/new/page'
    );
    render(React.createElement(DomainsNewPage));

    fireEvent.change(screen.getByRole('textbox', { name: /domain/i }), {
      target: { value: 'example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    });

    // Wait for instructions to render.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /verify now/i })).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /verify now/i }));
    });

    // Second fetch call must be to the verify endpoint.
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const [verifyUrl, verifyOpts] = fetchSpy.mock.calls[1]!;
    expect(String(verifyUrl)).toMatch(/\/api\/domains\/example\.com\/verify$/);
    expect((verifyOpts as RequestInit).method).toBe('POST');

    // Verified state appears.
    await waitFor(() =>
      expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Error paths
// ─────────────────────────────────────────────────────────────────────────────
describe('DomainsNewPage — error paths', () => {
  async function renderPage() {
    const { default: DomainsNewPage } = await import('../app/dashboard/domains/new/page');
    render(React.createElement(DomainsNewPage));
  }

  it('401 on POST /api/domains shows "Please sign in" error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: /domain/i }), {
      target: { value: 'example.com' },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue/i })); });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/please sign in/i),
    );
  });

  it('non-401 API error shows error message from response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid domain format' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: /domain/i }), {
      target: { value: 'not-a-domain' },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue/i })); });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/invalid domain format/i),
    );
  });

  it('Cancel button resets form back to idle state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          domain: 'example.com',
          verify_token: 'abc123',
          methods: { dns: 'txt', well_known: 'wk', meta: 'meta' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: /domain/i }), {
      target: { value: 'example.com' },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue/i })); });
    // Instructions should be visible.
    await waitFor(() => expect(screen.getByRole('button', { name: /verify now/i })).toBeTruthy());
    // Click Cancel.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    // Should be back to idle: domain input visible, instructions gone.
    await waitFor(() => expect(screen.getByRole('textbox', { name: /domain/i })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /verify now/i })).toBeNull();
  });

  it('verify-not-found shows retry message without leaving instructions view', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ domain: 'example.com', verify_token: 'tok', methods: { dns: '', well_known: '', meta: '' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verified: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: /domain/i }), {
      target: { value: 'example.com' },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue/i })); });
    await waitFor(() => expect(screen.getByRole('button', { name: /verify now/i })).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /verify now/i })); });
    // Should stay on instructions with a "couldn't find" message.
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t find/i),
    );
    expect(screen.getByRole('button', { name: /verify now/i })).toBeTruthy();
  });
});
