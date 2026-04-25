-- Deploy 0003_page_captures
-- Spec ref: §4.1, §5.13 — page_captures.

BEGIN;

-- 0003_page_captures.sql — page_captures (spec §4.1, §5.13).
--
-- One row per (study, side). For single studies side is NULL; for paired
-- studies side is 'A' or 'B'. The Capture Broker writes this row after it
-- validates the typed message from the capture container (§5.13) and
-- persists artifacts to object storage. The unique index covers both
-- shapes via COALESCE so a single study cannot insert two captures, and
-- a paired study cannot insert two same-side captures.

create table if not exists page_captures (
  id                     int8        generated always as identity primary key,
  study_id               int8        not null references studies (id) on delete cascade,
  side                   text
    check (side is null or side in ('A', 'B')),
  url_hash               text        not null,
  a11y_storage_key       text        not null,
  screenshot_storage_key text,
  host_count             int4        not null,
  status                 text        not null
    check (status in ('ok', 'blocked', 'error')),
  breach_reason          text,
  captured_at            timestamptz not null default now()
);

comment on table page_captures is 'Capture Broker artifact row (spec §5.13). One per (study, side).';
comment on column page_captures.side is 'A or B for paired studies; NULL for single-URL studies';
comment on column page_captures.url_hash is 'Salted SHA-256 of the captured URL — raw URLs never logged (spec §5.12)';
comment on column page_captures.a11y_storage_key is 'Object-storage key for the redacted a11y-tree dump (≤ 10 MB; 30-day TTL)';
comment on column page_captures.screenshot_storage_key is 'Opt-in only (spec §2 #32); 7-day TTL; never sent to LLM providers';
comment on column page_captures.host_count is 'Distinct egress host count observed during capture; cap is 50 (spec §2 #5)';
comment on column page_captures.status is 'ok = artifact persisted; blocked = bot wall (§2 #28); error = breach/timeout';
comment on column page_captures.breach_reason is 'Set when a resource ceiling tripped (spec §2 #6) — wall, RAM, byte cap, host cap';

/* (study_id, side) unique — including the single-URL case where side IS NULL. */
create unique index if not exists uq_page_captures_study_side
  on page_captures (study_id, coalesce(side, ''));

create index if not exists idx_page_captures_status on page_captures (status);

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0003_page_captures.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
