-- 0005_visits.sql — visits (spec §4.1, §5.1, §5.3, §2 #15).
--
-- One row per (backstory, side). Status flow per spec §5.3:
--   started → ok | failed | indeterminate.
-- parsed jsonb holds the validated visitor output — see spec §2 #15 +
-- amendment A1 for the exact zod-validated shape (next_action enum is
-- validated at the API/worker boundary, not in the DB; columns stay
-- text-jsonb-flexible so amendment churn lands in zod, not in migrations).
-- raw_storage_key points to the un-parsed provider response held for
-- 30-day forensic retention.
-- repair_generation: 0..2 per spec §2 #14 — each schema-repair retry
-- increments and produces a NEW logical_request_key.
-- transport_attempts: monotonic counter for the same logical request
-- (spec §5.15 — observability only).

create table if not exists visits (
  id                  int8        generated always as identity primary key,
  backstory_id        int8        not null references backstories (id) on delete cascade,
  side                text        not null
    check (side in ('A', 'B')),
  status              text        not null
    check (status in ('started', 'ok', 'failed', 'indeterminate')),
  parsed              jsonb,
  raw_storage_key     text,
  repair_generation   int4        not null default 0,
  transport_attempts  int4        not null default 0,
  score               numeric,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  unique (backstory_id, side)
);

comment on table visits is 'One row per (backstory, side). State machine in spec §5.3.';
comment on column visits.side is 'A or B; for single-URL studies all visits use side A';
comment on column visits.status is 'started → ok | failed | indeterminate (spec §5.3)';
comment on column visits.parsed is 'Validated visitor JSON output (spec §2 #15 + amendment A1). Schema enforced at boundary, not in DB.';
comment on column visits.raw_storage_key is 'Object-storage key for the raw provider response (30-day TTL, §2 #33)';
comment on column visits.repair_generation is '0..2; each schema-repair retry increments and gets a new logical_request_key (§2 #14)';
comment on column visits.transport_attempts is 'Observability counter for transport retries under the same logical_request_key (§5.15)';
comment on column visits.score is 'Per-visit conversion-weighted score from amendment A1 scoreVisit(parsed); NULL until visit reaches ok';

create index if not exists idx_visits_backstory_id on visits (backstory_id);
create index if not exists idx_visits_status on visits (status);
