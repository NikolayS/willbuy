'use client';

import { useState } from 'react';

import type { ReportT } from './types';

// Spec §5.18 #7 — persona cards grid, sortable by |score_b - score_a|
// (largest swings first). Click expands = full response on each variant
// + WTB reasoning (loaded on demand in production; the fixture inlines
// preview verdicts).

type Persona = ReportT['personas'][number];

const ROLE_LABEL: Record<Persona['role'], string> = {
  founder_or_eng_lead: 'founder / eng lead',
  ic_engineer: 'IC engineer',
};

function PersonaCard({
  persona,
  onClick,
}: {
  persona: Persona;
  onClick: () => void;
}) {
  const swing = persona.score_b - persona.score_a;
  const swingSign = swing > 0 ? '+' : '';
  const swingColor = swing > 0 ? 'text-green-700' : swing < 0 ? 'text-red-700' : 'text-gray-600';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`persona-card-${persona.backstory_id}`}
      data-backstory-id={persona.backstory_id}
      className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{persona.backstory_name}</h3>
        <span className={`text-sm font-medium ${swingColor}`}>
          {swingSign}
          {swing}
        </span>
      </div>
      <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
        {ROLE_LABEL[persona.role]}
      </p>
      <dl className="mt-2 space-y-1 text-xs text-gray-700">
        <div>
          <dt className="inline font-medium">stage:</dt> <dd className="inline">{persona.stage}</dd>
        </div>
        <div>
          <dt className="inline font-medium">team:</dt> <dd className="inline">{persona.team_size}</dd>
        </div>
        <div>
          <dt className="inline font-medium">stack:</dt> <dd className="inline">{persona.stack}</dd>
        </div>
        <div>
          <dt className="inline font-medium">pain:</dt> <dd className="inline">{persona.current_pain}</dd>
        </div>
        <div>
          <dt className="inline font-medium">entry:</dt> <dd className="inline">{persona.entry_point}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-3 text-sm text-gray-800">
        <span>A: {persona.score_a}</span>
        <span>B: {persona.score_b}</span>
      </div>
    </button>
  );
}

function PersonaDrawer({
  persona,
  onClose,
}: {
  persona: Persona;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="persona-drawer"
      className="rounded-lg border border-gray-300 bg-white p-6 shadow-md"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{persona.backstory_name}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-500 underline focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          close
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {ROLE_LABEL[persona.role]} · {persona.stage} · team {persona.team_size} · {persona.stack}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div data-testid="drawer-verdict-A" className="rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Variant A · score {persona.score_a}
          </p>
          <p className="mt-2 text-sm text-gray-800">{persona.verdict_a}</p>
        </div>
        <div data-testid="drawer-verdict-B" className="rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Variant B · score {persona.score_b}
          </p>
          <p className="mt-2 text-sm text-gray-800">{persona.verdict_b}</p>
        </div>
      </div>
    </div>
  );
}

export function PersonaGrid({ personas }: { personas: ReportT['personas'] }) {
  const [active, setActive] = useState<string | null>(null);
  // Sort by |score_b - score_a| desc; stable by id.
  const sorted = [...personas].sort((p, q) => {
    const dp = Math.abs(p.score_b - p.score_a);
    const dq = Math.abs(q.score_b - q.score_a);
    if (dq !== dp) return dq - dp;
    return p.backstory_id.localeCompare(q.backstory_id);
  });
  const activePersona = sorted.find((p) => p.backstory_id === active) ?? null;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Persona cards</h2>
      <p className="text-sm text-gray-600">
        Sorted by |Δ score| — largest swings first. Click a card for the full A/B verdicts.
      </p>
      <div data-testid="persona-grid" className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((p) => (
          <PersonaCard key={p.backstory_id} persona={p} onClick={() => setActive(p.backstory_id)} />
        ))}
      </div>
      {activePersona ? (
        <PersonaDrawer persona={activePersona} onClose={() => setActive(null)} />
      ) : null}
    </section>
  );
}
