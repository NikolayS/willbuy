-- 0001_accounts_and_keys.sql — accounts + api_keys (spec §4.1, §2 #21).
--
-- accounts: one row per signed-up willbuy.dev tenant. owner_email is the
--   billing/admin contact; verified_domains and other policy state land in
--   later sprints. Account-level FKs across the rest of the schema cascade
--   on account delete (account-deletion semantics in spec §2 #33 — the
--   tombstone + 21-day backup window are out of scope for this migration).
-- api_keys: per-account pluggable API auth. Spec §2 #21 caps active keys
--   at ≤ 2 per account; revoked keys are kept for audit but do not count.
--   The cap is enforced by a trigger because a partial unique index
--   ("≤ 2 NULL revoked_at rows per account_id") is not expressible in
--   plain index syntax.

create table if not exists accounts (
  id          int8        generated always as identity primary key,
  owner_email text        not null,
  created_at  timestamptz not null default now()
);

comment on table accounts is 'willbuy.dev tenant — one per signed-up customer (spec §4.1)';
comment on column accounts.owner_email is 'Billing/admin contact email; not auth — auth is API key or Supabase session';

create table if not exists api_keys (
  id            int8        generated always as identity primary key,
  account_id    int8        not null references accounts (id) on delete cascade,
  key_hash      text        not null unique,
  prefix        text        not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

comment on table api_keys is 'Per-account API keys — sk_live_… (spec §2 #21, §5.8). ≤ 2 active per account.';
comment on column api_keys.key_hash is 'SHA-256 of the raw key; the raw key is shown to the user once and never persisted';
comment on column api_keys.prefix is 'sk_live_<first8> for UI display so the user can identify the key without unmasking';
comment on column api_keys.revoked_at is 'NULL = active; non-NULL = revoked at this timestamp';

create index if not exists idx_api_keys_account_active
  on api_keys (account_id)
  where revoked_at is null;

/* ≤ 2 active keys per account — enforced by trigger. spec §2 #21. */
create or replace function enforce_api_keys_active_cap()
  returns trigger
  language plpgsql
as $$
declare
  active_count int;
begin
  if new.revoked_at is null then
    select count(*) into active_count
    from api_keys
    where account_id = new.account_id
      and revoked_at is null
      and (tg_op = 'INSERT' or id <> new.id);
    if active_count >= 2 then
      raise exception 'api_keys: account % already has 2 active keys', new.account_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_api_keys_active_cap on api_keys;
create trigger trg_api_keys_active_cap
  before insert or update of account_id, revoked_at on api_keys
  for each row
  execute function enforce_api_keys_active_cap();
