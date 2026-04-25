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

import type { ReportT, Tier } from './types';

// Spec §5.18 #5 — tier-picked distribution per variant. Horizontal
// stacked bar; conversion-weighted score is the anchor (in headline);
// this shows WHICH paid tier draws intent.

const ORDERED_TIERS: Tier[] = [
  'none',
  'hobby',
  'express',
  'starter',
  'scale',
  'enterprise',
];

const TIER_COLOR: Record<Tier, string> = {
  none: '#dc2626',
  hobby: '#94a3b8',
  express: '#eab308',
  starter: '#84cc16',
  scale: '#22c55e',
  enterprise: '#15803d',
};

const TIER_LABEL: Record<Tier, string> = {
  none: 'None',
  hobby: 'Hobby',
  express: 'Express',
  starter: 'Starter',
  scale: 'Scale',
  enterprise: 'Enterprise',
};

export function TierPicked({ rows }: { rows: ReportT['tier_picked'] }) {
  const data = rows.map((r) => {
    const obj: Record<string, number | string> = { variant: r.variant };
    for (const t of ORDERED_TIERS) {
      obj[t] = r.counts[t] ?? 0;
    }
    return obj;
  });
  return (
    <section
      data-testid="tier-picked"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">Tier picked (per variant)</h2>
      <p className="mt-1 text-sm text-gray-600">
        Horizontal stacked bar across <code>none → enterprise</code>.
      </p>
      <div className="mt-4 h-48 w-full">
        <ResponsiveContainer width="100%" height={192}>
          <BarChart layout="vertical" data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="variant" />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {ORDERED_TIERS.map((t) => (
              <Bar
                key={t}
                dataKey={t}
                stackId="tier"
                fill={TIER_COLOR[t]}
                name={TIER_LABEL[t]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
