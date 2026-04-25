-- Deploy 0019_api_keys_label
-- Spec ref: §4.1 (API-key auth) + issue #81 (API-key management UI).

BEGIN;

-- 0019_api_keys_label.sql — add `label` column to api_keys (issue #81).
--
-- The api_keys table from 0001_accounts_and_keys.sql lacked a user-facing
-- label/name column. Issue #81 (API-key management UI) requires the user
-- to give each key a human-readable label so they can identify keys at a
-- glance ("CI deploy", "production worker", etc.) without unmasking.
--
-- Default '' so this migration is safe to apply against an existing
-- database with key rows already present (key holders just see an empty
-- label until they rotate). New keys created via the management UI must
-- supply a non-empty label.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';

COMMENT ON COLUMN api_keys.label IS
  'User-facing key label (issue #81). Non-empty for keys created via the management UI; '
  'empty string for legacy rows pre-issue-81.';

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0019_api_keys_label.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
