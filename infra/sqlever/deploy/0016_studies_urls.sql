-- Deploy 0016_studies_urls
-- Spec ref: §4.1, §4.3 — persist target URLs on studies (issue #84 / PR #96 B3 fix).

BEGIN;

-- 0016_studies_urls.sql — persist target URLs on the studies row (spec §4.1, §4.3).
--
-- Issue #84 / PR #96 follow-up. The studies table per 0002_studies.sql intentionally
-- omitted spec §4.3 columns (urls, authorization_mode, icp_id, n, seed,
-- screenshots_enabled, cost_cents) — issue #26 scoped that batch to the
-- infrastructure tables only and deferred the API columns. PR #96 review
-- (B3) surfaced that the capture-worker production entrypoint had no source
-- of truth for the target URL: every visit fell into a synthetic
-- `about:blank` capture. This migration adds the minimum column needed by
-- the capture worker — `urls text[]` — keeping schema drift small.
--
-- Shape: text[] holding 1 (single-URL study) or 2 (paired A/B) URLs.
-- Ordering matches `visits.variant_idx`:
--   variant_idx=0 → studies.urls[1]   (PostgreSQL arrays are 1-indexed)
--   variant_idx=1 → studies.urls[2]

alter table studies
  add column if not exists urls text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'studies_urls_cardinality_chk'
       and conrelid = 'studies'::regclass
  ) then
    alter table studies
      add constraint studies_urls_cardinality_chk
        check (urls is null or (array_length(urls, 1) between 1 and 2));
  end if;
end $$;

comment on column studies.urls is 'Target URL list (spec §4.3); 1 entry for single, 2 for paired A/B. variant_idx indexes into this array (0-based externally → 1-based PG).';

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0016_studies_urls.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
