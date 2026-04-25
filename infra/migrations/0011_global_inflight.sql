-- 0011_global_inflight.sql — global backpressure tables (spec §5.14).
--
-- global_inflight: per-kind in-flight counter. The API server bumps this
-- counter under SKIP LOCKED + conditional update (spec §5.14) before
-- admitting a study/visit/probe; bumps it back down on terminal. Caps per
-- spec §2 #30: visit ≤ 100, capture ≤ 30, probe ≤ 20.
-- provider_circuit_state: one row per provider; state ∈ {closed, open,
-- half_open}. 5 consecutive 5xx in 60 s → open for 60 s; half-open probes
-- a single request; closed on success (spec §5.14).
-- rate_tokens: per-provider token-bucket bounded at 0.8× the provider's
-- published rate (spec §5.14). Refilled by a cron-like worker; drained
-- conditionally by every provider call.

create table if not exists global_inflight (
  kind        text        primary key,
  count       int4        not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table global_inflight is 'Per-kind in-flight counter for global concurrency caps (spec §5.14, §2 #30)';
comment on column global_inflight.kind is 'visit | capture | probe — caller-defined; caps live in app config, not DB';

create table if not exists provider_circuit_state (
  provider     text        primary key,
  state        text        not null default 'closed'
    check (state in ('closed', 'open', 'half_open')),
  opened_at    timestamptz,
  last_5xx_at  timestamptz
);

comment on table provider_circuit_state is 'Per-provider circuit breaker state (spec §5.14)';
comment on column provider_circuit_state.provider is 'Provider identifier (e.g. anthropic); PK — one row per provider (spec §5.14)';
comment on column provider_circuit_state.state is 'closed = healthy; open = fail fast; half_open = single probe in flight';
comment on column provider_circuit_state.opened_at is 'Set when transitioning to open; cleared on closed';
comment on column provider_circuit_state.last_5xx_at is 'Most recent 5xx; used by the 5-in-60-s rule';

create table if not exists rate_tokens (
  provider     text        primary key,
  tokens       int4        not null default 0,
  refilled_at  timestamptz not null default now()
);

comment on table rate_tokens is 'Per-provider token bucket bounded at 0.8× published rate (spec §5.14)';
comment on column rate_tokens.provider is 'Provider identifier (e.g. anthropic); PK — one token bucket per provider (spec §5.14)';
comment on column rate_tokens.tokens is 'Current available tokens; drained on every provider call, refilled periodically';
