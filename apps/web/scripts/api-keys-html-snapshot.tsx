/**
 * scripts/api-keys-html-snapshot.tsx — emits an HTML excerpt of the list page
 * for the issue #81 PR body. Pure renderer (no API calls), so it's safe to
 * run anywhere. Run with:
 *
 *   bun run apps/web/scripts/api-keys-html-snapshot.tsx
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { ApiKeysView } from '../app/dashboard/api-keys/ApiKeysView';

const fixture = [
  {
    id: 17,
    label: 'CI deploy',
    prefix: 'sk_live_Z',
    last_used_at: '2026-04-25T18:14:52.000Z',
    revoked_at: null,
    created_at: '2026-04-25T18:00:00.000Z',
  },
  {
    id: 16,
    label: 'old worker',
    prefix: 'sk_live_q',
    last_used_at: '2026-04-22T10:30:00.000Z',
    revoked_at: '2026-04-23T11:00:00.000Z',
    created_at: '2026-04-19T08:00:00.000Z',
  },
];

const html = renderToStaticMarkup(<ApiKeysView keys={fixture} />);
console.log(html);
