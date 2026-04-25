-- 0008_llm_spend_daily.sql — daily spend cap accounting (spec §5.5) + cap_warnings.
--
-- llm_spend_daily: row-per-(account, date, kind). The atomic-INSERT-with-WHERE
-- pattern in spec §5.5 is taken on EVERY provider-call kind before the
-- outbound call:
--   insert into llm_spend_daily (account_id, date, kind, cents)
--     values ($acct, current_date, $kind, $est)
--     on conflict (account_id, date, kind)
--     do update set cents = llm_spend_daily.cents + excluded.cents
--     where llm_spend_daily.cents + excluded.cents <= $cap
--     returning cents;
-- No row returned → cap exceeded → caller transitions to failed:cap_exceeded
-- and posts a refund. PK is (account_id, date, kind) so the upsert is race-free.
--
-- cap_warnings: side table gating the 50%-of-cap email so exactly one fires
-- per account per day per kind. PK (account_id, date, kind) per spec §5.5.

create table if not exists llm_spend_daily (
  account_id  int8        not null references accounts (id) on delete cascade,
  date        date        not null,
  kind        text        not null
    check (kind in ('visit', 'embedding', 'cluster_label', 'probe')),
  cents       int4        not null default 0,
  primary key (account_id, date, kind)
);

comment on table llm_spend_daily is 'Daily spend bucket per (account, date, kind) — race-free cap enforcement (spec §5.5)';
comment on column llm_spend_daily.kind is 'visit | embedding | cluster_label | probe; embeddings cost 0¢ but still write rows';
comment on column llm_spend_daily.cents is 'Sum of provider-call cost_cents for this (account, date, kind)';

create table if not exists cap_warnings (
  account_id  int8        not null references accounts (id) on delete cascade,
  date        date        not null,
  kind        text        not null,
  sent_at     timestamptz not null default now(),
  primary key (account_id, date, kind)
);

comment on table cap_warnings is '50%-of-cap warning email gate — at most one per (account, date, kind) (spec §5.5)';
comment on column cap_warnings.kind is 'Free-form gate kind (e.g. cap_50_warning); not constrained to the spend kinds';
