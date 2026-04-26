// Server-only seam for reading a report payload by slug. Actual fetch
// against the API (with share-token cookie auth per §5.12) lands when
// the report-API endpoint is wired (sprint-2 issue S2-6, #31's
// neighborhood). For now we serve the fixture under a single
// well-known slug so the report page is testable end-to-end and the
// lighthouse perf budget can run against it.
//
// `WILLBUY_REPORT_FIXTURE` env (default off) gates the fixture path.
// Production deploy sets it to `disabled`; dev / preview / test set it
// to `enabled`. This stays out of the prod surface area.
//
// Return value is a discriminated union:
//   - 'not_found'  API returned 404 (study_id invalid or report expired)
//   - 'pending'    API returned 200 but report_json is null (aggregator not yet run)
//   - unknown      API returned 200 with valid report_json (parsed payload)

import fixture from '../../../test/fixtures/report.fixture.json';

const FIXTURE_SLUG = 'test-fixture';

export type FetchReportResult = 'not_found' | 'pending' | unknown;

export async function fetchReport(slug: string): Promise<FetchReportResult> {
  if (
    process.env.WILLBUY_REPORT_FIXTURE === 'enabled' &&
    slug === FIXTURE_SLUG
  ) {
    return fixture;
  }

  const apiBase = process.env.WILLBUY_API_URL;
  if (apiBase) {
    const res = await fetch(`${apiBase}/reports/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });

    if (res.status === 404) {
      return 'not_found';
    }

    if (res.ok) {
      const body = await res.json() as { report_json: unknown };
      if (body.report_json === null || body.report_json === undefined) {
        return 'pending';
      }
      return body.report_json;
    }

    // Non-404 error (5xx etc.) — treat as not_found to avoid leaking internals.
    return 'not_found';
  }

  // No API URL configured and not a fixture slug — treat as not_found.
  return 'not_found';
}
