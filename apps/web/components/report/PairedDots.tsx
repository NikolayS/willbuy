'use client';

import { useState } from 'react';
import {
  CartesianGrid,
  Cell,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReportT } from './types';

// Spec §5.18 #2 — the key viz. Per-visitor dots showing A vs B with a
// thin connecting segment, color-coded by swing direction. Hover/click
// reveals backstory + both verdicts.
//
// Implementation: two Scatter series (A and B) share the same x-axis
// (1..n) so each backstory occupies one column. The thin connecting
// segment is drawn via Recharts <Customized />, which receives the live
// chart scales so we can map (x, score_a) → (x, score_b) into SVG
// pixel coordinates and emit one <line> per backstory.

const SWING_COLOR: Record<ReportT['paired_dots'][number]['swing'], string> = {
  a_wins: '#dc2626', // red — variant A scored higher
  tie: '#9ca3af', // gray
  b_wins: '#16a34a', // green — variant B (NEW) scored higher
};

export const __test__ = { SWING_COLOR };

// Shape passed by Recharts to <Customized component={...} />.
// We only use the axis maps to compute pixel coordinates.
interface CustomizedProps {
  xAxisMap?: Record<string, { scale: (v: number) => number }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
}

function Connectors({
  data,
  xAxisMap,
  yAxisMap,
}: CustomizedProps & { data: ReturnType<typeof buildData> }) {
  const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
  const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
  if (!xScale || !yScale) return null;

  return (
    <g>
      {data.map((d) => (
        <line
          key={d.backstory_id}
          data-connector={d.backstory_id}
          x1={xScale(d.x)}
          y1={yScale(d.score_a)}
          x2={xScale(d.x)}
          y2={yScale(d.score_b)}
          stroke={SWING_COLOR[d.swing]}
          strokeWidth={1.5}
          strokeOpacity={0.6}
        />
      ))}
    </g>
  );
}

function buildData(rows: ReportT['paired_dots']) {
  const sorted = [...rows].sort((p, q) => {
    const dp = Math.abs(p.score_b - p.score_a);
    const dq = Math.abs(q.score_b - q.score_a);
    if (dq !== dp) return dq - dp;
    return p.backstory_id.localeCompare(q.backstory_id);
  });
  return sorted.map((row, idx) => ({
    x: idx + 1,
    score_a: row.score_a,
    score_b: row.score_b,
    swing: row.swing,
    backstory_id: row.backstory_id,
    backstory_name: row.backstory_name,
  }));
}

export function PairedDots({ rows }: { rows: ReportT['paired_dots'] }) {
  const [active, setActive] = useState<string | null>(null);
  const data = buildData(rows);

  const activeRow = rows.find((r) => r.backstory_id === active) ?? null;

  return (
    <section
      data-testid="paired-dots"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">Paired-delta dot plot</h2>
      <p className="mt-1 text-sm text-gray-600">
        One column per backstory. Red = A higher, green = B higher, gray = tie.
      </p>
      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height={256}>
          <ScatterChart margin={{ top: 16, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" name="Backstory" tick={false} />
            <YAxis type="number" domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} />
            <ReferenceLine y={5} stroke="#d1d5db" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ fontSize: 12 }}
              formatter={(v: number) => v.toFixed(0)}
            />
            {/* Connector lines drawn before dots so dots render on top. */}
            <Customized
              component={(props: CustomizedProps) => (
                <Connectors {...props} data={data} />
              )}
            />
            <Scatter
              name="A"
              data={data}
              dataKey="score_a"
              fill="#1f2937"
              shape="circle"
              onClick={(d) => setActive((d as { backstory_id: string }).backstory_id)}
            />
            {/* F2: use <Cell> for per-dot swing coloring (Recharts contract). */}
            <Scatter
              name="B"
              data={data}
              dataKey="score_b"
              shape="circle"
              onClick={(d) => setActive((d as { backstory_id: string }).backstory_id)}
            >
              {data.map((d) => (
                <Cell key={d.backstory_id} fill={SWING_COLOR[d.swing]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {activeRow ? (
        <div
          data-testid="paired-dot-card"
          className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800"
        >
          <div className="font-medium">{activeRow.backstory_name}</div>
          <div className="text-xs text-gray-600">
            A score: {activeRow.score_a} · B score: {activeRow.score_b} · swing:{' '}
            {activeRow.swing.replace('_', ' ')}
          </div>
        </div>
      ) : null}
    </section>
  );
}
