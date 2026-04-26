# Observability — architectural decisions

**Spec refs:** §5.12 (field-level logging policy), §7 (DevOps observability),
§9 (log-as-second-data-store risk). **Issue:** [#118](https://github.com/NikolayS/willbuy/issues/118)

## Decision: local rotated files

All services on `willbuy-v01` write structured JSONL logs to
`/var/log/willbuy/<service>.jsonl`. `logrotate` runs daily, keeps **14 days**,
gzips old segments, and uses `copytruncate` so pino's open file handle keeps
writing into the freshly truncated file. Loki / Grafana shipping is **stubbed
but not wired** until log volume makes per-host `jq` painful; the shared
factory's `destination` override is the future seam.

| Service        | Log path                                 |
| -------------- | ---------------------------------------- |
| api            | `/var/log/willbuy/api.jsonl`             |
| capture-broker | `/var/log/willbuy/capture-broker.jsonl`  |
| capture-worker | `/var/log/willbuy/capture-worker.jsonl`  |
| visitor-worker | `/var/log/willbuy/visitor-worker.jsonl`  |
| aggregator     | Python/structlog — out of scope v0.2     |

## Redaction policy (spec §5.12)

Every log line passes through `@willbuy/log`'s `redactor.ts`. Allowlisted id
fields (`account_id`, `study_id`, `visit_id`, `provider_attempt_id`,
`transport_attempt_id`, `event`, `duration_*`, `error_class`) pass verbatim.
Everything else is scrubbed: URLs hashed, `api_key` masked, emails masked,
forbidden fields (`share_token`, `provider_payload`, `a11y_tree`, `llm_output`,
`backstory`, `password`, `page_bytes`) stripped, 32+ char tokens masked, HTML/
> 16 KiB strings size-markered. All rules apply recursively.

To add a §5.12 forbidden field: update `REMOVE_FIELDS` in
`packages/log/src/redactor.ts` and add a test in
`packages/log/test/redactor.test.ts`.

## Decision: zero-dep Prometheus registry (apps/api, issue #119)

`apps/api` exposes `GET /metrics` (bearer-token gated) via a hand-rolled
Prometheus serializer (`apps/api/src/metrics/registry.ts`) rather than
`prom-client` (~20 transitive deps, Bun-flaky process collector). We enforce
label-cardinality via TS enum types; a future swap to `prom-client` or OTel
exporter is a single-file change.

## Out of scope (v0.2)

Loki/Grafana, OpenTelemetry, worker-side metrics, Alertmanager (#120),
`/admin/health` (#121), Python aggregator log wiring.

Runbook: docs/runbooks/observability-runbook.md
