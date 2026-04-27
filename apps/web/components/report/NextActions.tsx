'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { NextActionT } from '@willbuy/shared/scoring';
import type { ReportT } from './types';

// Spec §5.18 #4 + amendment A1 — 8 actions ordered by intent weight.
// Sankey toggle added in v0.1.1 (#175).

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

// Color palette for Sankey variant nodes (source nodes).
const VARIANT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];

type ChartMode = 'bar' | 'sankey';

function buildSankeyData(rows: ReportT['next_actions']) {
  // Source nodes: one per variant. Target nodes: 8 action buckets.
  // Node order: variants first, then actions.
  const variantNodes = rows.map((r) => ({ name: `Variant ${r.variant}` }));
  const actionNodes = ORDERED_ACTIONS.map((a) => ({ name: ACTION_LABEL[a] }));
  const nodes = [...variantNodes, ...actionNodes];

  const links: { source: number; target: number; value: number }[] = [];
  rows.forEach((row, variantIdx) => {
    ORDERED_ACTIONS.forEach((action, actionIdx) => {
      const count = row.counts[action] ?? 0;
      if (count > 0) {
        links.push({
          source: variantIdx,
          target: rows.length + actionIdx,
          value: count,
        });
      }
    });
  });

  return { nodes, links };
}

// Custom Sankey node renderer that colours variant nodes by index and
// action nodes by their ACTION_COLOR.
function renderSankeyNode(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: { name?: string };
  variantCount: number;
}) {
  const { x = 0, y = 0, width = 8, height = 0, index = 0, payload, variantCount } = props;
  const isVariant = index < variantCount;
  let fill: string;
  if (isVariant) {
    fill = VARIANT_COLORS[index % VARIANT_COLORS.length] ?? '#6366f1';
  } else {
    const actionIdx = index - variantCount;
    const action = ORDERED_ACTIONS[actionIdx];
    fill = action ? ACTION_COLOR[action] : '#94a3b8';
  }
  const label = payload?.name ?? '';
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} />
      <text
        x={isVariant ? x - 4 : x + width + 4}
        y={y + height / 2}
        textAnchor={isVariant ? 'end' : 'start'}
        dominantBaseline="middle"
        style={{ fontSize: 10, fill: '#374151' }}
      >
        {label}
      </text>
    </g>
  );
}

export function NextActions({ rows }: { rows: ReportT['next_actions'] }) {
  const [mode, setMode] = useState<ChartMode>('bar');

  // Recharts wants one row per x-axis tick; we want one tick per variant.
  const data = rows.map((r) => {
    const obj: Record<string, number | string> = { variant: r.variant };
    for (const action of ORDERED_ACTIONS) {
      obj[action] = r.counts[action] ?? 0;
    }
    return obj;
  });

  const sankeyData = buildSankeyData(rows);
  const variantCount = rows.length;

  return (
    <section
      data-testid="next-actions"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Next-action distribution</h2>
          <p className="mt-1 text-sm text-gray-600">
            8 actions ordered by intent weight (amendment A1).{' '}
            {mode === 'bar' ? 'Stacked counts per variant.' : 'Flow from variant to action.'}
          </p>
        </div>
        {/* Toggle */}
        <div
          data-testid="next-actions-mode-toggle"
          className="flex shrink-0 overflow-hidden rounded border border-gray-200 text-sm"
        >
          <button
            type="button"
            onClick={() => setMode('bar')}
            className={`px-3 py-1 transition-colors ${
              mode === 'bar'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Stacked bar
          </button>
          <button
            type="button"
            onClick={() => setMode('sankey')}
            className={`px-3 py-1 transition-colors ${
              mode === 'sankey'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Sankey
          </button>
        </div>
      </div>

      {mode === 'bar' && (
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
      )}

      {mode === 'sankey' && (
        <div data-testid="next-actions-sankey" className="mt-4 w-full overflow-x-auto">
          <Sankey
            width={600}
            height={320}
            data={sankeyData}
            nodePadding={12}
            nodeWidth={12}
            margin={{ top: 8, right: 120, bottom: 8, left: 80 }}
            node={(props: Record<string, unknown>) =>
              renderSankeyNode({ ...props, variantCount } as Parameters<typeof renderSankeyNode>[0])
            }
            link={{ stroke: '#d1d5db', strokeOpacity: 0.5 }}
          >
            <Tooltip contentStyle={{ fontSize: 12 }} />
          </Sankey>
        </div>
      )}
    </section>
  );
}

export const __test__ = { ORDERED_ACTIONS, ACTION_LABEL };
