-- 0018_api_keys_label.sql — add `label` column to api_keys (issue #81).
--
-- The api_keys table from 0001_accounts_and_keys.sql lacked a user-facing
-- label/name column. Issue #81 (API-key management UI) requires the user
-- to give each key a human-readable label so they can identify keys at a
-- glance ("CI deploy", "production worker", etc.) without unmasking.
--
-- Spec refs: §4.1 (API-key auth), §5.1 (api_keys schema), issue #81 §
-- "lists keys (name, last 4 chars, …)".
--
-- Default '' so this migration is safe to apply against an existing
-- database with key rows already present (key holders just see an empty
-- label until they rotate). New keys created via the management UI must
-- supply a non-empty label.

alter table api_keys
  add column if not exists label text not null default '';

comment on column api_keys.label is
  'User-facing key label (issue #81). Non-empty for keys created via the management UI; '
  'empty string for legacy rows pre-issue-81.';
