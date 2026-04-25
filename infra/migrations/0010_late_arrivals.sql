-- 0010_late_arrivals.sql — late_arrivals (spec §5.11).
--
-- Late visits that complete after a study has transitioned to ready/failed
-- write here instead of mutating the report. Used for forensic audit and
-- spend reconciliation; never folded back into the report. Visit lease
-- expiry past the 3-min aggregate timeout (§5.11) is the typical source.

create table if not exists late_arrivals (
  id           int8        generated always as identity primary key,
  study_id     int8        not null references studies (id) on delete cascade,
  visit_id     int8        not null references visits (id) on delete cascade,
  arrived_at   timestamptz not null default now(),
  payload_key  text
);

comment on table late_arrivals is 'Visits that completed after study terminal — never fold back into the report (spec §5.11)';
comment on column late_arrivals.payload_key is 'Object-storage key for the late visit payload; same retention as raw_storage_key (§2 #33)';

create index if not exists idx_late_arrivals_study_id on late_arrivals (study_id);
