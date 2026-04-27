// @vitest-environment jsdom
//
// TDD acceptance tests for PublishButton (components/dashboard/PublishButton.tsx).
//
// The component has three observable states:
//   1. Unpublished  — "Make report public" button visible
//   2. Published    — replaced by "Report is now public" + share link
//   3. Error        — error message shown, button re-enabled
//
// And an initialPublished=true shortcut (pre-populates published state
// on first render so the API response from GET /studies/:id is reflected).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PublishButton } from '../components/dashboard/PublishButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PublishButton', () => {
  it('renders "Make report public" button when not yet published', () => {
    render(<PublishButton studyId={42} reportSlug="test-fixture" />);
    expect(screen.getByRole('button', { name: /make report public/i })).toBeTruthy();
    expect(screen.queryByText(/report is now public/i)).toBeNull();
  });

  it('skips the button and shows share link when initialPublished=true', () => {
    render(
      <PublishButton studyId={42} reportSlug="test-fixture" initialPublished={true} />,
    );
    expect(screen.queryByRole('button', { name: /make report public/i })).toBeNull();
    const link = screen.getByRole('link', { name: /share this link/i });
    expect(link.getAttribute('href')).toBe('/r/test-fixture');
  });

  it('clicking publish calls POST /api/studies/:id/publish and shows share link on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    render(<PublishButton studyId={7} reportSlug="my-report" />);
    fireEvent.click(screen.getByRole('button', { name: /make report public/i }));

    await waitFor(() =>
      expect(screen.queryByText(/report is now public/i)).not.toBeNull(),
    );

    expect(fetch).toHaveBeenCalledWith('/api/studies/7/publish', { method: 'POST' });
    const link = screen.getByRole('link', { name: /share this link/i });
    expect(link.getAttribute('href')).toBe('/r/my-report');
  });

  it('shows error message on non-2xx JSON response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not authorised' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<PublishButton studyId={7} reportSlug="my-report" />);
    fireEvent.click(screen.getByRole('button', { name: /make report public/i }));

    await waitFor(() =>
      expect(screen.queryByText(/not authorised/i)).not.toBeNull(),
    );

    // Button must still be present so the user can retry.
    expect(screen.getByRole('button', { name: /make report public/i })).toBeTruthy();
  });

  it('shows generic error on non-JSON error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    render(<PublishButton studyId={7} reportSlug="my-report" />);
    fireEvent.click(screen.getByRole('button', { name: /make report public/i }));

    await waitFor(() =>
      expect(screen.queryByText(/publish failed/i)).not.toBeNull(),
    );
  });

  it('shows generic error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<PublishButton studyId={7} reportSlug="my-report" />);
    fireEvent.click(screen.getByRole('button', { name: /make report public/i }));

    await waitFor(() =>
      expect(screen.queryByText(/network error/i)).not.toBeNull(),
    );
  });

  it('button is disabled while request is in-flight', async () => {
    let resolveResponse!: (r: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveResponse = resolve; }),
    );

    render(<PublishButton studyId={7} reportSlug="my-report" />);
    fireEvent.click(screen.getByRole('button', { name: /make report public/i }));

    // Button should show disabled "Publishing…" state during in-flight request.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /publishing/i }).hasAttribute('disabled')).toBe(true),
    );

    // Resolve the request so cleanup doesn't leak pending state.
    resolveResponse(new Response(null, { status: 200 }));
    await waitFor(() =>
      expect(screen.queryByText(/report is now public/i)).not.toBeNull(),
    );
  });
});
