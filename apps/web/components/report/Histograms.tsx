'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReportT, VariantId } from './types';

// Spec §5.18 #3 — discrete 0–10 will-to-buy bins per variant; mean and
// median annotated. Side-by-side default; overlay toggle (v0.1.1).

const VARIANT_COLOR: Record<VariantId, string> = {
  A: '#475569', // slate
  B: '#16a34a', // green (matches dot-plot "B wins")
};

type HistMode = 'side-by-side' | 'overlay';

function HistOne({ row }: { row: ReportT['histograms'][number] }) {
  const data = row.bins.map((count, score) => ({ score, count }));
  return (
    <div
      data-testid={`histogram-${row.variant}`}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-gray-900">Variant {row.variant}</h3>
        <span className="text-xs text-gray-600">
          mean {row.mean.toFixed(2)} · median {row.median}
        </span>
      </div>
      <div className="mt-2 h-48 w-full">
        <ResponsiveContainer width="100%" height={192}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="score" tickCount={11} />
            <YAxis allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="count" fill={VARIANT_COLOR[row.variant]} />
            <ReferenceLine x={row.mean} stroke="#dc2626" strokeDasharray="4 2" />
            <ReferenceLine x={row.median} stroke="#2563eb" strokeDasharray="2 2" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HistOverlay({ histograms }: { histograms: ReportT['histograms'] }) {
  const data = Array.from({ length: 11 }, (_, score) => {
    const entry: Record<string, number> = { score };
    for (const h of histograms) entry[h.variant] = h.bins[score] ?? 0;
    return entry;
  });
  return (
    <div
      data-testid="histogram-overlay"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="score" tickCount={11} />
          <YAxis allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {histograms.map((h) => (
            <Bar
              key={h.variant}
              dataKey={h.variant}
              fill={VARIANT_COLOR[h.variant]}
              fillOpacity={0.6}
            />
          ))}
          {histograms.flatMap((h) => [
            <ReferenceLine
              key={`mean-${h.variant}`}
              x={h.mean}
              stroke={VARIANT_COLOR[h.variant]}
              strokeDasharray="4 2"
            />,
            <ReferenceLine
              key={`median-${h.variant}`}
              x={h.median}
              stroke={VARIANT_COLOR[h.variant]}
              strokeDasharray="2 2"
            />,
          ])}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Histograms({ histograms }: { histograms: ReportT['histograms'] }) {
  const [mode, setMode] = useState<HistMode>('side-by-side');
  const canOverlay = histograms.length === 2;
  return (
    <section>
      {canOverlay && (
        <div className="flex gap-2 mb-4" data-testid="histogram-mode-toggle">
          <button
            onClick={() => setMode('side-by-side')}
            aria-pressed={mode === 'side-by-side'}
            className="rounded px-3 py-1 text-sm font-medium border border-gray-300 data-[pressed=true]:bg-gray-100"
            data-pressed={mode === 'side-by-side'}
          >
            Side by side
          </button>
          <button
            onClick={() => setMode('overlay')}
            aria-pressed={mode === 'overlay'}
            className="rounded px-3 py-1 text-sm font-medium border border-gray-300 data-[pressed=true]:bg-gray-100"
            data-pressed={mode === 'overlay'}
          >
            Overlay
          </button>
        </div>
      )}
      {mode === 'overlay' && canOverlay ? (
        <HistOverlay histograms={histograms} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {histograms.map((h) => (
            <HistOne key={h.variant} row={h} />
          ))}
        </div>
      )}
    </section>
  );
}
