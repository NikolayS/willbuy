'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReportT, ThemeCategory } from './types';

// Spec §5.18 #6 — top blockers / objections / confusions / questions.
// Four horizontal bar-charts of cluster frequency. Clicking a cluster
// expands a quote drawer with attributed raw strings. Cluster labels
// come from the LLM labeling step (§5.7); raw quotes are redacted per
// §5.9. The quote drawer's content is auth-gated (loaded on click) per
// the §5.18 perf budget — wire shape includes only the cluster summary.
//
// In v0.1 we render a placeholder quote drawer that says quotes load on
// click; the actual fetch lands in the persona/quote API issue.

const CATEGORIES: { key: ThemeCategory; label: string }[] = [
  { key: 'blockers', label: 'Blockers' },
  { key: 'objections', label: 'Objections' },
  { key: 'confusions', label: 'Confusions' },
  { key: 'questions', label: 'Questions' },
];

function CategoryChart({
  category,
  clusters,
  onClickCluster,
}: {
  category: ThemeCategory;
  clusters: ReportT['theme_board'][ThemeCategory];
  onClickCluster: (clusterId: string) => void;
}) {
  const safeClusters = clusters ?? [];
  const data = [...safeClusters]
    .sort((a, b) => b.count - a.count)
    .map((c) => ({ label: c.label, count: c.count, cluster_id: c.cluster_id }));
  return (
    <div
      data-testid={`theme-${category}`}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3 className="font-semibold capitalize text-gray-900">{category}</h3>
      <div className="mt-2 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="count"
              fill="#2563eb"
              onClick={(d) => onClickCluster((d as { cluster_id: string }).cluster_id)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ThemeBoard({ board }: { board: ReportT['theme_board'] }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <section data-testid="theme-board" className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Theme board</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CATEGORIES.map(({ key }) => (
          <CategoryChart
            key={key}
            category={key}
            clusters={board[key]}
            onClickCluster={setActive}
          />
        ))}
      </div>
      {active ? (
        <div
          data-testid="quote-drawer"
          className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800"
        >
          <p className="font-medium">Cluster: {active}</p>
          <p className="mt-1 text-xs text-gray-600">
            Quotes load on demand (auth-gated per spec §5.18).
          </p>
        </div>
      ) : null}
    </section>
  );
}
