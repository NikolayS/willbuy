-- 0004_backstories_and_leases.sql — backstories + backstory_leases (spec §2 #12, §5.11).
--
-- backstories: deterministic per-study sample (seeded; spec §5.7). idx is the
--   stable ordinal within the study; (study_id, idx) is unique.
-- backstory_leases: separate row per active lease, distinct from the visit-job
--   lease. Spec §2 #12 enforces "one backstory in exactly one in-flight LLM
--   context at a time" — the lease row is INSERTed on acquisition, UPDATEd on
--   heartbeat, DELETEd on visit terminal commit OR lease_until expiry.
--   Primary key is (backstory_id) so the lease is naturally exclusive. The
--   lease_until + heartbeat_at + lease_owner mirror spec §4.3 and §5.3.
-- Inline lease_until/lease_owner/heartbeat_at columns on backstories are kept
--   as a denormalized hint for read paths; the canonical lease state lives in
--   backstory_leases. The dual-write happens inside the visit-worker
--   transaction so the two cannot diverge across a commit boundary.

create table if not exists backstories (
  id            int8        generated always as identity primary key,
  study_id      int8        not null references studies (id) on delete cascade,
  idx           int4        not null,
  payload       jsonb       not null,
  lease_until   timestamptz,
  lease_owner   text,
  heartbeat_at  timestamptz,
  unique (study_id, idx)
);

comment on table backstories is 'Per-study sampled backstories (spec §2 #12, §5.7). Deterministic by (seed, study_id, idx).';
comment on column backstories.idx is 'Stable ordinal within the study, 0..n-1; (study_id, idx) is unique';
comment on column backstories.payload is 'jsonb structured fields + rendered_text; shape owned by zod schema in packages/shared';
comment on column backstories.lease_until is 'Denormalized hint mirroring backstory_leases.lease_until; NULL when not leased';

create table if not exists backstory_leases (
  backstory_id  int8        primary key references backstories (id) on delete cascade,
  study_id      int8        not null references studies (id) on delete cascade,
  lease_until   timestamptz not null,
  lease_owner   text        not null,
  heartbeat_at  timestamptz not null default now()
);

comment on table backstory_leases is 'Per-backstory lease — exactly one in-flight LLM context per backstory (spec §2 #12, §5.11)';
comment on column backstory_leases.lease_until is '120 s from acquisition; refreshed by heartbeat every 15 s';
comment on column backstory_leases.lease_owner is 'visit_id (or worker id) holding the lease; logged for contention metrics (§5.12)';

create index if not exists idx_backstory_leases_study on backstory_leases (study_id);
create index if not exists idx_backstory_leases_lease_until on backstory_leases (lease_until);
