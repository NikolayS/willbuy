// @vitest-environment jsdom
//
// ShareLinkButton.test.tsx — TDD acceptance tests for issue #487.
//
// Spec refs: §2 #20 (share-token minting), user story 3.
//
// Tests:
//   1. Renders "Get private share link" button.
//   2. On click, fires POST /api/studies/:id/share-token.
//   3. On 201 response: hides the button and shows the URL in a <code> block
//      plus a "Copy" button.
//   4. On 409 response: shows "A share link already exists" message.
//   5. On other error (500): shows a generic error message.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareLinkButton } from '../components/dashboard/ShareLinkButton';

// Minimal clipboard API stub so navigator.clipboard.writeText doesn't throw.
const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ShareLinkButton (issue #487)', () => {
  it('1. renders "Get private share link" button', () => {
    render(<ShareLinkButton studyId={42} />);
    expect(screen.getByRole('button', { name: /get private share link/i })).toBeTruthy();
  });

  it('2. fires POST /api/studies/:id/share-token on click', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'abc12345678901234567890',
          url: 'https://willbuy.dev/r/42?t=abc12345678901234567890',
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<ShareLinkButton studyId={42} />);
    fireEvent.click(screen.getByRole('button', { name: /get private share link/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/studies/42/share-token',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('3. shows URL in <code> block + Copy button on 201', async () => {
    const shareUrl = 'https://willbuy.dev/r/42?t=abc12345678901234567890';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'abc12345678901234567890',
          url: shareUrl,
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<ShareLinkButton studyId={42} />);
    fireEvent.click(screen.getByRole('button', { name: /get private share link/i }));

    // Button should be replaced with a URL code block.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /get private share link/i })).toBeNull();
    });

    // The URL should appear inside a <code> element.
    const codeEl = document.querySelector('code');
    expect(codeEl).toBeTruthy();
    expect(codeEl!.textContent).toBe(shareUrl);

    // A "Copy" button should be present.
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });

  it('4. shows "share link already exists" message on 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'conflict' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<ShareLinkButton studyId={42} />);
    fireEvent.click(screen.getByRole('button', { name: /get private share link/i }));

    await waitFor(() => {
      expect(screen.getByText(/a share link already exists/i)).toBeTruthy();
    });
  });

  it('5. shows generic error message on 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'internal server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<ShareLinkButton studyId={42} />);
    fireEvent.click(screen.getByRole('button', { name: /get private share link/i }));

    await waitFor(() => {
      // Some error message should be visible.
      expect(screen.getByTestId('share-link-error')).toBeTruthy();
    });
  });
});
