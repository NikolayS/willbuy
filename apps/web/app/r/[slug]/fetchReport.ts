// Server-only seam — fetches the §5.18 report_json blob for a given slug.
// Fixture path (WILLBUY_REPORT_FIXTURE=enabled + slug=test-fixture) stays
// active for dev/preview; all other slugs hit the real API.

import { cookies } from 'next/headers';
import fixture from '../../../test/fixtures/report.fixture.json';

const FIXTURE_SLUG = 'test-fixture';

function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://localhost:3001';
}

export async function fetchReport(slug: string): Promise<unknown | null> {
  if (
    process.env.WILLBUY_REPORT_FIXTURE === 'enabled' &&
    slug === FIXTURE_SLUG
  ) {
    return fixture;
  }

  // cookies() throws outside a request scope (e.g. in unit tests); treat as no cookie.
  let cookieVal: string | undefined;
  try {
    cookieVal = (await cookies()).get(`wb_rt_${slug}`)?.value;
  } catch {
    cookieVal = undefined;
  }
  const headers: Record<string, string> = {};
  if (cookieVal !== undefined) {
    headers['cookie'] = `wb_rt_${slug}=${cookieVal}`;
  }

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/reports/${slug}`, {
      cache: 'no-store',
      headers,
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const body = (await res.json()) as Record<string, unknown>;
  return body['report_json'] ?? null;
}
