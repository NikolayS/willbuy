# Observability — structured-log shipping

**Spec refs:** §5.12 (field-level logging policy), §7 (DevOps observability),
§9 (log-as-second-data-store risk).

**Issue:** [#118](https://github.com/NikolayS/willbuy/issues/118)

## Decision: local rotated files

For v0.2 (and likely v0.3) all services on `willbuy-v01` write structured
JSONL logs to `/var/log/willbuy/<service>.jsonl`. `logrotate` runs daily,
keeps **14 days** (spec §5.12), gzips old segments, and uses
`copytruncate` so pino's open file handle keeps writing into the freshly
truncated file.

Loki / Grafana shipping is **stubbed but not wired** — it stays out
until we hit a log volume that makes per-host `jq` painful. The shared
factory accepts a `destination` override so when we do flip to Loki it's
a single-package change.

| Service          | Path on host                              |
| ---------------- | ----------------------------------------- |
| api              | `/var/log/willbuy/api.jsonl`              |
| capture-broker   | `/var/log/willbuy/capture-broker.jsonl`   |
| capture-worker   | `/var/log/willbuy/capture-worker.jsonl`   |
| visitor-worker   | `/var/log/willbuy/visitor-worker.jsonl`   |
| aggregator       | (Python; structlog → its own file. Out of scope for v0.2 — see below.) |

## How to query

Single service, follow live:

```bash
tail -f /var/log/willbuy/api.jsonl | jq
```

All services, last 5 minutes, errors only:

```bash
for f in /var/log/willbuy/*.jsonl; do
  jq -c 'select(.level >= 50)' "$f" \
    | tail -n 200
done
```

By visit_id across services:

```bash
jq -c 'select(.visit_id == "v_01H...")' /var/log/willbuy/*.jsonl
```

Rotated segments (compressed) — `zcat` first:

```bash
zcat /var/log/willbuy/api.jsonl-*.gz | jq -c 'select(.event == "capture.failed")'
```

## Redaction policy (spec §5.12)

Every log line passes through `@willbuy/log`'s redactor before reaching
disk. The redactor is the **single source of truth**; live in
`packages/log/src/redactor.ts`. It enforces:

- `account_id`, `study_id`, `visit_id`, `provider_attempt_id`,
  `transport_attempt_id`, `event`, `duration_ms`, `error_class` →
  emitted verbatim.
- URL fields (named `url`, `*_url`, or any string value matching `^https?://`)
  → replaced with `<field>_hash`, a salted SHA-256 truncated to 16 hex
  chars. Salt comes from `WILLBUY_LOG_HASH_SALT` (required in
  production).
- `api_key` field → masked to `***<last4>`.
- `email` field → masked to `<first-letter>***@<domain-first-letter>***.<tld>`.
  Bare email values under any other field name are also masked.
- `share_token`, `provider_payload`, `a11y_tree`, `llm_output`,
  `backstory`, `password`, `page_bytes` → field stripped at any depth.
- Strings that are 32+ char hex/base64 (or JWT-shaped) → masked as a
  defence-in-depth catch for misnamed bearer credentials.
- Strings longer than 16 KiB or HTML-shaped → replaced with
  `[redacted:<bytecount>b]` (catches captured-page bytes leaked under
  generic field names).
- Recursive: all rules apply at any nesting depth. DAG-shared subtrees
  are NOT falsely flagged as `[Circular]`; only true self-references
  are.

If you add a new spec §5.12 forbidden field, update
`REMOVE_FIELDS` in `packages/log/src/redactor.ts` AND add a test in
`packages/log/test/redactor.test.ts`.

## Retention

Configured via `infra/observability/logrotate.conf`:

```
daily
rotate 14
compress
delaycompress
copytruncate
dateext
```

Validate the config with `logrotate -d infra/observability/logrotate.conf`.

## Configuration

Environment variables read by `@willbuy/log`:

| Variable                  | Default               | Notes                                                                              |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `NODE_ENV`                | (unset)               | `production` → write to file; otherwise stdout (unless overridden).                |
| `WILLBUY_LOG_TO_FILE`     | (derived)             | `1` forces file mode; `0` forces stdout. Useful for staging.                        |
| `WILLBUY_LOG_HASH_SALT`   | (none / dev-fallback) | Required in `production`. Throws on first call if unset there.                     |
| `LOG_LEVEL`               | `info`                | Standard pino level.                                                               |

## Out of scope (v0.2)

- Loki / Grafana wiring (deferred; the destination interface in
  `@willbuy/log` is the future seam).
- OpenTelemetry tracing (separate issue).
- Centralised log query UI (use `jq`).
- The Python aggregator (`apps/aggregator/`) — uses `structlog`, not
  pino. Rotation will be wired in a follow-up; the rotation policy
  (14 days, copytruncate) is the same.

## Adding a logger to a new service

1. Add `"@willbuy/log": "workspace:*"` and `"pino": "^9.5.0"` to the
   service's `package.json` dependencies.
2. Create `apps/<service>/src/logger.ts`:
   ```ts
   import { buildLogger } from '@willbuy/log';
   export const log = buildLogger({ service: '<service>' });
   ```
3. In production set `WILLBUY_LOG_HASH_SALT` and `NODE_ENV=production`.
4. Logs will appear at `/var/log/willbuy/<service>.jsonl`.
5. Add the service to the table at the top of this doc.

---

# Metrics — Prometheus exposition (issue #119, apps/api slice)

`apps/api` exposes a Prometheus exposition endpoint at **`GET /metrics`**,
gated by a shared-secret bearer token (`WILLBUY_METRICS_TOKEN`). This is
the v0.2 first slice of the issue-#119 metrics surface; the worker-side
counters from spec §5.14 (capture/visit/provider attempts, circuit-breaker
state, token-bucket fill, global in-flight) ship in follow-up issues that
extend the same exposition pattern to `apps/capture-worker`,
`apps/visitor-worker`, and `apps/aggregator`.

## Decision: zero-dep registry, not `prom-client` (apps/api v0.2)

We hand-rolled a small Prometheus 0.0.4 exposition serializer in
`apps/api/src/metrics/registry.ts` rather than pulling `prom-client`.
Rationale:

- `prom-client` adds ~20 transitive deps and a Bun-test-runner-flaky
  process collector we don't need; the exposition format is small and
  stable.
- We control label-cardinality enforcement at the call sites (TS enum
  types) — the registry rejects unknown label keys at write time,
  catching cardinality bugs in development.
- Future swap to `prom-client` (or OTel Prometheus exporter for v0.3+
  tracing) is a single-file change; the recording API
  (`recordStudyStarted`, `recordHttpRequest`, etc.) is registry-agnostic.

Worker-side metrics may pick `prom-client` independently if the worker's
runtime story is different — this decision is scoped to apps/api.

## Auth model

Bearer token in `Authorization: Bearer <token>`, constant-time compare
against `WILLBUY_METRICS_TOKEN`. **If `WILLBUY_METRICS_TOKEN` is unset
the endpoint is locked down — every request returns 401**. This is the
fail-closed default; never silently expose metrics on a misconfigured
host.

Operational setup:

```bash
# Generate
op item create --vault willbuy --category 'API Credential' \
  --title metrics-bearer-token \
  credential[concealed]=$(openssl rand -hex 32)

# Inject at boot
op inject -i .env.template -o .env  # references op://willbuy/metrics-bearer-token/credential
```

Prometheus scrape config (single-instance Prometheus on willbuy-v01,
follow-up issue wires this for all services):

```yaml
scrape_configs:
  - job_name: willbuy-api
    bearer_token_file: /etc/prometheus/willbuy-metrics-token
    static_configs:
      - targets: ['127.0.0.1:3001']
    scrape_interval: 15s
```

## Metrics catalogue (apps/api v0.2 slice)

### Business signals

| Metric                                | Type      | Labels                  | Notes                                                                                  |
| ------------------------------------- | --------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `willbuy_studies_started_total`       | counter   | `kind`                  | `kind` ∈ {single, paired} (§2 #12). Incremented after the `POST /studies` commit.       |
| `willbuy_studies_completed_total`     | counter   | `kind`, `outcome`       | `outcome` ∈ {ok, partial, failed}. Wired in by the finalize path (§5.4 partial-finalize). |
| `willbuy_visits_total`                | counter   | `persona_pool`          | `persona_pool` is the bounded ICP-archetype id (§2 #9) or `"custom"`.                  |
| `willbuy_credits_consumed_total`      | counter   | `kind`                  | Cumulative cents debited from `credit_ledger` (§5.4).                                   |
| `willbuy_active_studies`              | gauge     | (none)                  | Snapshot of in-flight studies (statuses pending/capturing/visiting/aggregating).        |

### System signals

| Metric                                       | Type      | Labels                          | Notes                                                                                              |
| -------------------------------------------- | --------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `willbuy_http_request_duration_seconds`      | histogram | `route`, `method`, `status`     | `route` is the parameterized template (`/reports/:slug`). Unmatched 404s collapse to `route="__unmatched__"` for bounded cardinality. Default buckets cover 5ms…30s. |
| `willbuy_process_start_time_seconds`         | gauge     | (none)                          | Unix-seconds at boot. Compute uptime as `time() - willbuy_process_start_time_seconds`.              |
| `willbuy_build_info`                         | gauge     | `version`                       | Always 1; `version` carries `apps/api/package.json` version.                                        |

### Cardinality discipline

The `route` label is the load-bearing one. Two guards:

1. **Source.** We pull from `request.routeOptions.url` (Fastify v5) — the
   parameterized template, not the literal request URL.
2. **404 collapse.** Unmatched routes report `route="__unmatched__"` so a
   path-fuzzer hitting random URLs cannot blow up the series count.

A vitest suite in `apps/api/test/metrics.test.ts` asserts both invariants
(literal-slug must NOT appear in any label value; at least one route
label must be a `:param`-bearing template).

## Out of scope (this slice)

- Worker-side metrics (capture/visit/provider/circuit-breaker) — separate
  issues, will land in their respective `apps/<worker>/src/metrics/`.
- Alertmanager wiring (issue #120).
- `/admin/health` UI (issue #121).
- `infra/observability/prometheus.yml` + installer — added once the
  worker-side metrics surface lands, so a single scrape config covers
  every service.
