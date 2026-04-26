// Server-only seam — fetches the §5.18 report_json blob for a given slug.
// Fixture path (WILLBUY_REPORT_FIXTURE=enabled + slug=test-fixture) stays
// active for dev/preview; all other slugs hit the real API.
//
// Return value is a discriminated union:
//   - 'not_found'  API returned 404 (study_id invalid, report expired, or fetch error)
//   - 'pending'    API returned 200 but report_json is null (aggregator not yet run)
//   - ReportPayload  API returned 200 with valid report_json (parsed payload + urls)

import { cookies } from 'next/headers';
import fixture from '../../../test/fixtures/report.fixture.json';

const FIXTURE_SLUG = 'test-fixture';

export type ReportPayload = { reportJson: unknown; urls: string[] | null };
export type FetchReportResult = 'not_found' | 'pending' | ReportPayload;

function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://localhost:3001';
}

export async function fetchReport(slug: string): Promise<FetchReportResult> {
  if (
    process.env.WILLBUY_REPORT_FIXTURE === 'enabled' &&
    slug === FIXTURE_SLUG
  ) {
    return { reportJson: fixture, urls: null };
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
    return 'not_found';
  }

  if (res.status === 404) return 'not_found';
  if (!res.ok) return 'not_found';

  const body = (await res.json()) as Record<string, unknown>;
  const reportJson = body['report_json'];
  if (reportJson === null || reportJson === undefined) return 'pending';
  const urls = Array.isArray(body['urls']) ? (body['urls'] as string[]) : null;
  return { reportJson, urls };
}
