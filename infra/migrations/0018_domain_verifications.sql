-- 0018_domain_verifications.sql
-- Sprint 3 — Auth #2 (issue #82): domain verification challenges.
--
-- Spec ref: §2 #1 (verified-domain authorization, v0.1).
--
-- Tracks the per-(account, domain) challenge state for the three
-- verification methods supported in v0.1:
--   1. DNS TXT record:  willbuy-verify=<token>
--   2. .well-known:     GET /.well-known/willbuy-verify returns <token>
--   3. <meta> tag:      <meta name="willbuy-verify" content="<token>">
--
-- The verify_token is the random 22-char nanoid the user must publish via
-- one of the three methods. We never store the token hashed because the
-- user must be shown the cleartext value to publish — there's no security
-- benefit to hashing it.
--
-- On a successful verification, the verifying handler:
--   1. Sets verified_at = now() on this row.
--   2. Atomically appends the domain to accounts.verified_domains (§2 #1).
-- Re-verification is idempotent: re-running POST /api/domains/:d/verify
-- on an already-verified row simply re-checks (no-op on success).
--
-- last_checked_at is updated on every probe (success or failure) so the
-- UI can show "last checked X ago" without an extra audit table.
--
-- UNIQUE (account_id, domain) means a given account has exactly one
-- challenge row per domain. The POST /api/domains handler upserts on
-- this constraint (rotates verify_token if the user re-requests).

CREATE TABLE IF NOT EXISTS domain_verifications (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      bigint      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  domain          text        NOT NULL,
  verify_token    text        NOT NULL,
  verified_at     timestamptz NULL,
  last_checked_at timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_verifications_account_domain_uniq UNIQUE (account_id, domain)
);

-- Lookup index for "list pending verifications for this account" queries
-- (issue #83 will build the dashboard list view).
CREATE INDEX IF NOT EXISTS domain_verifications_account_idx
  ON domain_verifications (account_id);
