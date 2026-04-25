-- Deploy 0018_domain_verifications
-- Spec ref: §2 #1 — verified-domain authorization (issue #82, Sprint 3 Auth #2).

BEGIN;

-- 0018_domain_verifications.sql
-- Sprint 3 — Auth #2 (issue #82): domain verification challenges.
--
-- Tracks the per-(account, domain) challenge state for the three
-- verification methods supported in v0.1:
--   1. DNS TXT record:  willbuy-verify=<token>
--   2. .well-known:     GET /.well-known/willbuy-verify returns <token>
--   3. <meta> tag:      <meta name="willbuy-verify" content="<token>">
--
-- On a successful verification, the verifying handler:
--   1. Sets verified_at = now() on this row.
--   2. Atomically appends the domain to accounts.verified_domains (§2 #1).
-- Re-verification is idempotent.

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

CREATE INDEX IF NOT EXISTS domain_verifications_account_idx
  ON domain_verifications (account_id);

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0018_domain_verifications.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
