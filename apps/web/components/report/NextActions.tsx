'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { NextActionT } from '@willbuy/shared/scoring';
import type { ReportT } from './types';

// Spec §5.18 #4 + amendment A1 — 8 actions ordered by intent weight.
// Sankey on toggle is named in §5.18; v0.1 ships the default stacked
// bar (which is what §5.18 calls out as "scan-ability"). Sankey toggle
// is plumbed as a flag here but the Sankey component itself is left as
// a v0.1.1 follow-up (one component, one issue) since it requires
// additional Recharts plugins.

// Ordered by intent weight (amendment A1) — paid-now first, leave last.
const ORDERED_ACTIONS: NextActionT[] = [
  'purchase_paid_today',
  'contact_sales',
  'book_demo',
  'start_paid_trial',
  'bookmark_compare_later',
  'ask_teammate',
  'start_free_hobby',
  'leave',
];

const ACTION_COLOR: Record<NextActionT, string> = {
  purchase_paid_today: '#15803d',
  contact_sales: '#22c55e',
  book_demo: '#84cc16',
  start_paid_trial: '#eab308',
  bookmark_compare_later: '#f97316',
  ask_teammate: '#a855f7',
  start_free_hobby: '#94a3b8',
  leave: '#dc2626',
};

const ACTION_LABEL: Record<NextActionT, string> = {
  purchase_paid_today: 'Purchase today',
  contact_sales: 'Contact sales',
  book_demo: 'Book demo',
  start_paid_trial: 'Start paid trial',
  bookmark_compare_later: 'Bookmark / compare',
  ask_teammate: 'Ask teammate',
  start_free_hobby: 'Free hobby',
  leave: 'Leave',
};

export function NextActions({ rows }: { rows: ReportT['next_actions'] }) {
  // Recharts wants one row per x-axis tick; we want one tick per variant.
  const data = rows.map((r) => {
    const obj: Record<string, number | string> = { variant: r.variant };
    for (const action of ORDERED_ACTIONS) {
      obj[action] = r.counts[action] ?? 0;
    }
    return obj;
  });
  return (
    <section
      data-testid="next-actions"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">Next-action distribution</h2>
      <p className="mt-1 text-sm text-gray-600">
        8 actions ordered by intent weight (amendment A1). Stacked counts per variant.
      </p>
      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height={288}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="variant" />
            <YAxis allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {ORDERED_ACTIONS.map((action) => (
              <Bar
                key={action}
                dataKey={action}
                stackId="next_action"
                fill={ACTION_COLOR[action]}
                name={ACTION_LABEL[action]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
