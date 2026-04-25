-- Deploy 0007_credit_ledger
-- Spec ref: §5.4, §4.3 — credit_ledger + account_balance view.

BEGIN;

-- 0007_credit_ledger.sql — credit_ledger + account_balance view (spec §5.4, §4.3).
--
-- Append-only signed-cents ledger. kind ∈ {top_up, reserve, commit, refund,
-- partial_finalize}. idempotency_key is UNIQUE — Stripe webhook event id,
-- study_id-scoped reserve key, provider_attempt_id-scoped commit key per
-- spec §5.4. Caller writes the sign convention (top_up positive; reserve
-- negative; commit zero-net inside a partial_finalize; refund positive;
-- partial_finalize captures the per-study terminal commit + refund residue).
--
-- provider_attempt_id FK: spec §4.3/§5.4 — commit(…, provider_attempt_id, …)
-- idempotency is enforced both by idempotency_key UNIQUE and by this FK which
-- guarantees that every commit/refund row references a real provider_attempts
-- row. NULL for top_up and reserve rows (no provider attempt yet).
--
-- provider_attempt_id NOT NULL CHECK: spec §5.4 — a commit or refund row with
-- NULL provider_attempt_id is unauditable; the CHECK enforces the invariant.
-- kind ∈ {top_up, reserve, partial_finalize} may have NULL provider_attempt_id.
--
-- account_balance(view): sum of cents per account for fast balance lookups.
-- Views over append-only ledgers are race-free by construction.

create table if not exists credit_ledger (
  id                   int8        generated always as identity primary key,
  account_id           int8        not null references accounts (id) on delete cascade,
  kind                 text        not null
    check (kind in ('top_up', 'reserve', 'commit', 'refund', 'partial_finalize')),
  study_id             int8        references studies (id) on delete set null,
  provider_attempt_id  int8        references provider_attempts (id) on delete set null,
  cents                int4        not null,
  idempotency_key      text        not null unique,
  created_at           timestamptz not null default now(),
  check (kind not in ('commit', 'refund') or provider_attempt_id is not null)
);

comment on table credit_ledger is 'Append-only credit ledger — top_up/reserve/commit/refund/partial_finalize (spec §5.4)';
comment on column credit_ledger.cents is 'Signed cents — top_up > 0; reserve < 0; refund > 0; commit/partial_finalize per §5.4';
comment on column credit_ledger.idempotency_key is 'UNIQUE: Stripe event id (top_up), study_id-scoped (reserve), provider_attempt_id (commit/refund)';
comment on column credit_ledger.study_id is 'NULL for top_ups; set for any study-scoped op so reconciliation joins are cheap';
comment on column credit_ledger.provider_attempt_id is 'FK to provider_attempts; NULL for top_up/reserve; required for commit/refund idempotency (spec §4.3/§5.4)';

create index if not exists idx_credit_ledger_account_id on credit_ledger (account_id);
create index if not exists idx_credit_ledger_study_id on credit_ledger (study_id);
create index if not exists idx_credit_ledger_provider_attempt_id on credit_ledger (provider_attempt_id);

create or replace view account_balance as
  select
    account_id,
    coalesce(sum(cents), 0)::int8 as balance_cents
  from credit_ledger
  group by account_id;

comment on view account_balance is 'Per-account balance: sum of credit_ledger.cents (spec §5.4)';

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0007_credit_ledger.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
