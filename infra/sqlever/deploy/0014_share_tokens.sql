-- Deploy 0014_share_tokens
-- Spec ref: §5.12 — share-token cookie-redirect flow (issue #76, PR #89).

BEGIN;

-- 0014_share_tokens.sql — share tokens for §5.12 cookie-redirect flow (issue #76).
--
-- Each row represents a revocable share link for a report. The raw token is
-- never stored — only its SHA-256 hex hash (token_hash). On first access the
-- server validates ?t=<token> against token_hash, then sets an HttpOnly cookie
-- and 302-redirects to the bare /r/<slug> URL (§5.12, spec §2 #20).
--
-- Lookup key: (report_slug) for fetching the token row, then timing-safe
-- hash comparison. UNIQUE(token_hash) prevents duplicate token issuance.
--
-- revoked_at: if set, the token is immediately invalid (→ 404).
-- expires_at: hard expiry; default 90 days from issuance.
-- account_id: FK to accounts, used in the HMAC cookie payload to bind the
--   cookie to the issuing account.

create table if not exists share_tokens (
  id           int8        generated always as identity primary key,
  report_slug  text        not null,
  token_hash   text        not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  account_id   int8        not null references accounts(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists share_tokens_report_slug_idx on share_tokens(report_slug);

comment on table share_tokens is 'Revocable share tokens for report access (§5.12, issue #76). Raw token never stored — only SHA-256 hash.';
comment on column share_tokens.report_slug is 'Matches reports.study_id::text (the stable URL slug for /r/<slug>)';
comment on column share_tokens.token_hash is 'SHA-256 hex of the raw share token; token only on URL query string at first access';
comment on column share_tokens.expires_at is 'Hard expiry (default 90 days); expired tokens → 404';
comment on column share_tokens.revoked_at is 'If set, token is immediately invalid → 404';
comment on column share_tokens.account_id is 'Issuing account; used in HMAC cookie payload binding';

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0014_share_tokens.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
