-- 0014_auth_magic_links.sql
-- Sprint 3 — Auth #1 (issue #79): magic-link sign-in tables.
--
-- auth_magic_links: stores sha256(token) so the raw token never hits the DB.
-- Indexed on token_hash for O(1) lookup in GET /api/auth/verify.
--
-- No `sessions` table: we use signed (HMAC) stateless cookies instead of
-- DB-backed sessions (simpler, no TTL-expiry job needed, revocation via
-- key rotation). The cookie payload is {account_id, expires_at} + HMAC.
--
-- Also adds UNIQUE constraint on accounts.owner_email so the upsert in
-- POST /api/auth/magic-link can use ON CONFLICT (owner_email).

ALTER TABLE accounts
  ADD CONSTRAINT accounts_owner_email_unique UNIQUE (owner_email);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  id          bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  bigint  NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- SHA-256 of the raw token, stored as a hex string.
  -- bytea would also work but hex string is simpler to compare and log-safe.
  token_hash  text    NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup in verify handler: WHERE token_hash = $1
CREATE INDEX IF NOT EXISTS auth_magic_links_token_hash_idx
  ON auth_magic_links (token_hash);

-- Prune old rows to keep the table lean (used or expired rows > 7 days old).
-- The verify handler only needs: used_at IS NULL AND expires_at > now().
-- Old rows are harmless but bloat the index; a future cleanup job can
-- DELETE WHERE created_at < now() - interval '7 days'.
