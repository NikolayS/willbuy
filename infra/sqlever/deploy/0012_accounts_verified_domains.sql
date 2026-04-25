-- Deploy 0012_accounts_verified_domains
-- Spec ref: §2 #1 — add verified_domains to accounts.

BEGIN;

-- 0012_accounts_verified_domains.sql — add verified_domains to accounts (spec §2 #1).
--
-- verified_domains is an array of eTLD+1 strings (e.g. 'example.com').
-- Populated by the domain-verification flow (Sprint 3); seeded manually
-- for v0.1 testing. Captures are only permitted against URLs whose eTLD+1
-- is in this array (spec §2 #1).
--
-- The array is NULL by default (no verified domains). An empty array {}
-- is treated the same as NULL — no domains verified.

alter table accounts
  add column if not exists verified_domains text[] not null default '{}';

comment on column accounts.verified_domains is 'eTLD+1 strings verified by this account (spec §2 #1). Populated by domain-verification flow (Sprint 3).';

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0012_accounts_verified_domains.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
