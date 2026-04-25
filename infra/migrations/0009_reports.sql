-- 0009_reports.sql — reports (spec §4.1, §4.3, §5.18, §5.11).
--
-- One report per study. UNIQUE(study_id) is the integrity constraint that
-- guarantees "exactly one report per study" — spec §5.11 explicitly notes
-- the aggregator's single-writer lock is an optimization, not the
-- correctness guarantee. UNIQUE(share_token_hash) backs token lookup.
-- public/expires_at gate visibility on /r/<slug>; raw token never stored
-- (only its hash). conv_score and paired_delta_json are the headline
-- numbers per spec §5.7 + §5.18.
--
-- clusters_json: pre-computed HDBSCAN cluster blobs written by the aggregator
--   for §5.18 theme board; avoids re-computation on every /r/<slug> load.
-- scores_json: per-variant and per-backstory conversion-weighted scores,
--   pre-computed for §5.18 histogram + Sankey.
-- paired_tests_disagreement: boolean flag written by the aggregator when
--   paired-t and Wilcoxon disagree in direction (spec §2 #19); the §5.18
--   disagreement banner reads this column at report-render time. NULL for
--   single-URL studies (no paired statistics).
-- default_share_token_id: FK to share_tokens (table added in API migration
--   for issue #xx — share_tokens table is not in this migration batch).
--   Column is present here as int8 nullable; FK constraint will be added by
--   the API migration once share_tokens exists. NULL until a share token is
--   created for the report.

create table if not exists reports (
  id                          int8        generated always as identity primary key,
  study_id                    int8        not null unique references studies (id) on delete cascade,
  share_token_hash            text        not null unique,
  public                      boolean     not null default false,
  expires_at                  timestamptz,
  conv_score                  numeric     not null,
  paired_delta_json           jsonb       not null,
  clusters_json               jsonb,
  scores_json                 jsonb,
  paired_tests_disagreement   boolean,
  default_share_token_id      int8,
  ready_at                    timestamptz not null default now()
);

comment on table reports is 'One report per study (spec §4.1, §5.11). UNIQUE(study_id) is the correctness guarantee.';
comment on column reports.share_token_hash is 'SHA-256 of the share token; raw token only on URL query string at first access (spec §2 #20)';
comment on column reports.public is 'Owner opt-in to public listing; still noindex (spec §2 #20)';
comment on column reports.expires_at is 'Default 90 days; revoke = set in past + cache purge';
comment on column reports.conv_score is 'Conversion-weighted score (spec §5.7, amendment A1)';
comment on column reports.paired_delta_json is 'Per-backstory paired-δ + paired-t + Wilcoxon + McNemar payload (spec §5.7)';
comment on column reports.clusters_json is 'Pre-computed HDBSCAN cluster blobs for §5.18 theme board; NULL until aggregator writes report';
comment on column reports.scores_json is 'Pre-computed per-variant and per-backstory scores for §5.18 histogram + Sankey; NULL until aggregated';
comment on column reports.paired_tests_disagreement is 'true when paired-t and Wilcoxon disagree in direction (spec §2 #19 banner); NULL for single-URL studies';
comment on column reports.default_share_token_id is 'FK to share_tokens.id (share_tokens added via API migration for issue #xx); NULL until first share token created';
