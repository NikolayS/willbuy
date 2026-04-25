-- 0009_reports.sql — reports (spec §4.1, §5.18, §5.11).
--
-- One report per study. UNIQUE(study_id) is the integrity constraint that
-- guarantees "exactly one report per study" — spec §5.11 explicitly notes
-- the aggregator's single-writer lock is an optimization, not the
-- correctness guarantee. UNIQUE(share_token_hash) backs token lookup.
-- public/expires_at gate visibility on /r/<slug>; raw token never stored
-- (only its hash). conv_score and paired_delta_json are the headline
-- numbers per spec §5.7 + §5.18.

create table if not exists reports (
  id                 int8        generated always as identity primary key,
  study_id           int8        not null unique references studies (id) on delete cascade,
  share_token_hash   text        not null unique,
  public             boolean     not null default false,
  expires_at         timestamptz,
  conv_score         numeric     not null,
  paired_delta_json  jsonb       not null,
  ready_at           timestamptz not null default now()
);

comment on table reports is 'One report per study (spec §4.1, §5.11). UNIQUE(study_id) is the correctness guarantee.';
comment on column reports.share_token_hash is 'SHA-256 of the share token; raw token only on URL query string at first access (spec §2 #20)';
comment on column reports.public is 'Owner opt-in to public listing; still noindex (spec §2 #20)';
comment on column reports.expires_at is 'Default 90 days; revoke = set in past + cache purge';
comment on column reports.conv_score is 'Conversion-weighted score (spec §5.7, amendment A1)';
comment on column reports.paired_delta_json is 'Per-backstory paired-δ + paired-t + Wilcoxon + McNemar payload (spec §5.7)';
