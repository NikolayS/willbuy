// @vitest-environment node
/**
 * dashboard-layout.test.tsx — tests for the /dashboard shell layout.
 *
 * DashboardLayout is a synchronous server component (no next/headers,
 * no redirect) so renderToStaticMarkup works directly.
 *
 * Tests:
 *   1. All four nav links render with correct hrefs.
 *   2. The sign-out form targets POST /api/auth/sign-out (CSP-safe form).
 *   3. The brand link points to /dashboard.
 *   4. Children are rendered inside the layout.
 *   5. No inline <script> or style= attributes (CSP §5.10).
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import DashboardLayout from '../app/dashboard/layout';

function getHtml(children = React.createElement('div', { id: 'child' }, 'content')): string {
  return renderToStaticMarkup(React.createElement(DashboardLayout, null, children));
}

describe('DashboardLayout — navigation links', () => {
  it('renders the Dashboard nav link pointing to /dashboard', () => {
    expect(getHtml()).toContain('href="/dashboard"');
  });

  it('renders the New study nav link pointing to /dashboard/studies/new', () => {
    expect(getHtml()).toContain('href="/dashboard/studies/new"');
  });

  it('renders the Domains nav link pointing to /dashboard/domains', () => {
    expect(getHtml()).toContain('href="/dashboard/domains"');
  });

  it('renders the Credits nav link pointing to /dashboard/credits', () => {
    expect(getHtml()).toContain('href="/dashboard/credits"');
  });
});

describe('DashboardLayout — sign-out form', () => {
  it('sign-out form action is /api/auth/sign-out', () => {
    expect(getHtml()).toContain('action="/api/auth/sign-out"');
  });

  it('sign-out form uses POST method (CSP-safe, no JS needed)', () => {
    expect(getHtml()).toContain('method="post"');
  });

  it('sign-out button is a submit button', () => {
    expect(getHtml()).toContain('type="submit"');
  });
});

describe('DashboardLayout — children rendering', () => {
  it('renders children inside the layout', () => {
    const html = getHtml(React.createElement('section', { 'data-testid': 'the-child' }, 'hello'));
    expect(html).toContain('data-testid="the-child"');
    expect(html).toContain('hello');
  });
});

describe('DashboardLayout — CSP §5.10', () => {
  it('contains no inline <script> tags', () => {
    expect(getHtml()).not.toMatch(/<script/i);
  });

  it('contains no style= attributes', () => {
    expect(getHtml()).not.toMatch(/\bstyle=/);
  });
});
