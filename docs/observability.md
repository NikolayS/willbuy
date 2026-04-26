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
