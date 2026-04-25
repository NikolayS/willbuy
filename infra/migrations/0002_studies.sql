-- 0002_studies.sql — studies table (spec §4.1, §5.3).
--
-- studies.kind: single | paired (paired = exactly two URLs, A and B).
-- studies.status flow per spec §5.3:
--   pending → capturing → visiting → aggregating → ready | failed.
-- finalized_at is set when status reaches a terminal value (ready/failed).
-- The single-writer aggregator lock (spec §5.11) is taken via
--   `select 1 from studies where id = $1 and status = 'aggregating' for update skip locked`
-- — no extra column needed; the row lock + status filter are the lock.

create table if not exists studies (
  id            int8        generated always as identity primary key,
  account_id    int8        not null references accounts (id) on delete cascade,
  kind          text        not null
    check (kind in ('single', 'paired')),
  status        text        not null default 'pending'
    check (status in ('pending', 'capturing', 'visiting', 'aggregating', 'ready', 'failed')),
  created_at    timestamptz not null default now(),
  finalized_at  timestamptz
);

comment on table studies is 'One row per study — single URL or paired A/B. State machine in spec §5.3.';
comment on column studies.kind is 'single = one URL, N visits; paired = two URLs (A,B), N paired visits';
comment on column studies.status is 'State machine: pending → capturing → visiting → aggregating → ready | failed (§5.3)';
comment on column studies.finalized_at is 'Set when status reaches ready or failed; NULL while in flight';

create index if not exists idx_studies_account_id on studies (account_id);
create index if not exists idx_studies_status on studies (status);
