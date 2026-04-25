-- 0005_visits.sql — visits (spec §4.1, §4.3, §5.1, §5.3, §2 #15).
--
-- One row per (study_id, backstory_id, variant_idx) — spec §4.3 canonical shape.
-- Status flow per spec §5.3: started → ok | failed | indeterminate.
-- variant_idx: 0 = variant A, 1 = variant B; for single-URL studies always 0.
--   (The `side` text column mapped to 'A'/'B'; variant_idx carries the same
--   semantics as a typed int, and the UNIQUE aligns with spec §4.3.)
-- capture_id FK links each visit to the page_captures row it scored; this is
--   the join §5.18 persona cards depend on.
-- provider/model/cost_cents: audit trail for partial_finalize (spec §5.4).
-- terminal_reason: set on failed/indeterminate per spec §5.3
--   {schema, transient, cap_exceeded, provider_error, lease_lost, indeterminate}.
-- latency_ms: round-trip from provider call start to first token (observability).
-- parsed jsonb holds the validated visitor output — see spec §2 #15 +
--   amendment A1 for the exact zod-validated shape (next_action enum is
--   validated at the API/worker boundary, not in the DB; columns stay
--   text-jsonb-flexible so amendment churn lands in zod, not in migrations).
-- raw_storage_key points to the un-parsed provider response held for
--   30-day forensic retention.
-- repair_generation: 0..2 per spec §2 #14 — each schema-repair retry
--   increments and produces a NEW logical_request_key.
-- transport_attempts: monotonic counter for the same logical request
--   (spec §5.15 — observability only).

create table if not exists visits (
  id                  int8        generated always as identity primary key,
  study_id            int8        not null references studies (id) on delete cascade,
  backstory_id        int8        not null references backstories (id) on delete cascade,
  variant_idx         int4        not null
    check (variant_idx in (0, 1)),
  capture_id          int8        references page_captures (id) on delete set null,
  provider            text,
  model               text,
  status              text        not null
    check (status in ('started', 'ok', 'failed', 'indeterminate')),
  parsed              jsonb,
  raw_storage_key     text,
  terminal_reason     text,
  repair_generation   int4        not null default 0,
  transport_attempts  int4        not null default 0,
  cost_cents          int4,
  latency_ms          int4,
  score               numeric,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  unique (study_id, backstory_id, variant_idx)
);

comment on table visits is 'One row per (study_id, backstory_id, variant_idx). State machine in spec §5.3.';
comment on column visits.study_id is 'FK to studies; denormalised from backstory for efficient per-study queries';
comment on column visits.backstory_id is 'FK to backstories; the paired A/B join key is (study_id, backstory_id)';
comment on column visits.variant_idx is '0 = variant A, 1 = variant B; single-URL studies always 0 (spec §4.3)';
comment on column visits.capture_id is 'FK to page_captures; NULL when capture is still pending at visit start (spec §5.18)';
comment on column visits.provider is 'LLM provider name (e.g. anthropic) — audit trail for partial_finalize (spec §5.4)';
comment on column visits.model is 'LLM model id (e.g. claude-haiku-4-5) — audit trail for partial_finalize (spec §5.4)';
comment on column visits.status is 'started → ok | failed | indeterminate (spec §5.3)';
comment on column visits.parsed is 'Validated visitor JSON output (spec §2 #15 + amendment A1). Schema enforced at boundary, not in DB.';
comment on column visits.raw_storage_key is 'Object-storage key for the raw provider response (30-day TTL, §2 #33)';
comment on column visits.terminal_reason is 'Set on failed/indeterminate: schema|transient|cap_exceeded|provider_error|lease_lost|indeterminate (§5.3)';
comment on column visits.repair_generation is '0..2; each schema-repair retry increments and gets a new logical_request_key (§2 #14)';
comment on column visits.transport_attempts is 'Observability counter for transport retries under the same logical_request_key (§5.15)';
comment on column visits.cost_cents is 'Actual cost in cents for this visit; NULL until committed; capped at 5¢ (spec §5.6)';
comment on column visits.latency_ms is 'Provider round-trip latency in ms (observability)';
comment on column visits.score is 'Per-visit conversion-weighted score from amendment A1 scoreVisit(parsed); NULL until visit reaches ok';

create index if not exists idx_visits_study_id on visits (study_id);
create index if not exists idx_visits_backstory_id on visits (backstory_id);
create index if not exists idx_visits_status on visits (status);
create index if not exists idx_visits_capture_id on visits (capture_id);

-- B4: add FK from backstory_leases.holder_visit_id → visits.id now that
-- visits exists. The column was added without a FK in 0004 to avoid a
-- forward-reference; the constraint is safe to add here idempotently.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'backstory_leases_holder_visit_id_fkey'
       and conrelid = 'backstory_leases'::regclass
  ) then
    alter table backstory_leases
      add constraint backstory_leases_holder_visit_id_fkey
        foreign key (holder_visit_id) references visits (id) on delete cascade;
  end if;
end $$;
