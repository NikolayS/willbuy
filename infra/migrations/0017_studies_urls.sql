-- 0017_studies_urls.sql — persist target URLs on the studies row (spec §4.1, §4.3).
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
--
-- The CHECK constraint mirrors the API zod schema in routes/studies.ts
-- (urls 1..2). It is permissive on URL syntax — the API layer validates
-- the URL strings; the column is text[] not a stricter type so future
-- amendments (e.g. signed-URL prefixes) don't require a migration.
--
-- nullable=true: kept nullable for backward compatibility with rows
-- inserted before this migration. Production rows from PR #96 onward
-- always set urls. The poller treats NULL as "no URL configured" and
-- fail-fasts the visit.

alter table studies
  add column if not exists urls text[];

-- The CHECK constraint enforces the 1..2 cardinality the API + spec require
-- ONLY when urls is not null (legacy rows have NULL).
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
