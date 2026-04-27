/**
 * /dashboard/api-keys/new — create-key form (issue #81).
 *
 * Server Component (GET). The form posts back to /dashboard/api-keys/new,
 * which is handled by route.ts in this same folder. The route handler
 * calls the API, then redirects (303) to /dashboard/api-keys/new?key=…
 * with the raw key value passed via a one-shot signed query parameter.
 *
 * Wait — passing the raw key in a query parameter would persist it in
 * server access logs and the browser history. So instead, the route
 * handler renders the result inline in its own response; the GET form
 * only renders the empty form (or an error from a failed prior submission
 * via ?error=…).
 *
 * Spec §5.10 — no client-side JS. No inline event handlers. Form submits
 * via the browser's native POST.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NewKeyFormView } from '../ApiKeysView';

export const dynamic = 'force-dynamic';

export default function NewApiKeyPage({
  searchParams,
}: {
  searchParams: { error?: string };
}): JSX.Element {
  // Auth gate — same pattern as the dashboard page. We don't fetch anything
  // for the form view, but a missing session means the POST will 401 anyway.
  const cookieStore = (cookies() as unknown) as {
    getAll: () => Array<{ name: string; value: string }>;
  };
  const all = cookieStore.getAll();
  const hasSession = all.some(
    (c) => c.name === 'wb_session' || c.name === '__Host-wb_session',
  );
  if (!hasSession) {
    redirect('/sign-in?redirect=%2Fdashboard%2Fapi-keys%2Fnew');
  }

  // exactOptionalPropertyTypes: only pass error when it's a string (not undefined).
  return searchParams.error
    ? <NewKeyFormView error={searchParams.error} />
    : <NewKeyFormView />;
}
