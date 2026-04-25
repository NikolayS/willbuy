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

import fixture from '../../../test/fixtures/report.fixture.json';

const FIXTURE_SLUG = 'test-fixture';

export async function fetchReport(slug: string): Promise<unknown | null> {
  if (
    process.env.WILLBUY_REPORT_FIXTURE === 'enabled' &&
    slug === FIXTURE_SLUG
  ) {
    return fixture;
  }
  // The real lookup lands when the report-API issue ships; for now any
  // non-fixture slug 404s.
  return null;
}
