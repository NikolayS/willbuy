-- 0006_provider_attempts.sql — unified provider-attempt ledger (spec §2 #16, §5.15).
--
-- Every outbound provider call across kinds {visit, embedding, cluster_label,
-- probe} writes a row here. logical_request_key is UNIQUE — it is
-- sha256(visit_id || provider || model || request_kind || repair_generation)
-- per spec §5.15 and is reused as the provider Idempotency-Key across
-- transport retries. transport_attempts counts on-wire retries that share
-- this logical key. status flow: started → ended | indeterminate
-- → indeterminate_refunded (spec §5.3, §5.4 reconciliation).
--
-- Embeddings are local in-process (spec §17) but still recorded here for
-- observability (count, duration, status); they never debit the spend cap.

create table if not exists provider_attempts (
  id                   int8        generated always as identity primary key,
  account_id           int8        not null references accounts (id) on delete cascade,
  study_id             int8        not null references studies (id) on delete cascade,
  kind                 text        not null
    check (kind in ('visit', 'embedding', 'cluster_label', 'probe')),
  logical_request_key  text        not null unique,
  provider             text        not null,
  model                text        not null,
  transport_attempts   int4        not null default 0,
  status               text        not null
    check (status in ('started', 'ended', 'indeterminate', 'indeterminate_refunded')),
  cost_cents           int4        not null default 0,
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  raw_output_key       text,
  error_class          text
);

comment on table provider_attempts is 'Unified provider-call ledger across all kinds (spec §2 #16, §5.15).';
comment on column provider_attempts.kind is 'visit | embedding | cluster_label | probe — all kinds participate in cap + reconciliation';
comment on column provider_attempts.logical_request_key is 'sha256(visit_id||provider||model||kind||repair_generation); reused as Idempotency-Key (§5.15)';
comment on column provider_attempts.transport_attempts is 'On-wire retries sharing the same logical_request_key; observability only';
comment on column provider_attempts.status is 'started → ended | indeterminate → indeterminate_refunded (resolved by reconciliation, §5.4)';
comment on column provider_attempts.cost_cents is 'Actual cost when ended; pessimistic ceiling (5¢) while indeterminate (§5.5)';
comment on column provider_attempts.raw_output_key is 'Object-storage key for the raw provider response (NULL for failed/indeterminate)';
comment on column provider_attempts.error_class is 'Coarse classification when not ended-ok: timeout, connection_reset, schema, 5xx, etc.';

create index if not exists idx_provider_attempts_study_kind_status
  on provider_attempts (study_id, kind, status);
create index if not exists idx_provider_attempts_account_id on provider_attempts (account_id);
