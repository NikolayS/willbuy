# Observability Runbook

> Architectural decision record: docs/observability.md

This runbook covers day-to-day operations: querying logs, interpreting
alert thresholds, and step-by-step remediation.

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

## Retention configuration

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

## Alert thresholds

These are the recommended alert thresholds for monitoring the log pipeline
and service health. Wire into Alertmanager (issue #120) when that lands.

| Signal                          | Threshold                          | Action                                            |
| ------------------------------- | ---------------------------------- | ------------------------------------------------- |
| `log_payload_oversize` events   | any occurrence                     | Investigate caller — likely a payload leak bug.   |
| Error rate (`level >= 50`)      | > 5 errors / minute / service      | Page on-call; check recent deploys.               |
| Log file missing / empty        | > 2 minutes with no new lines      | Check service health; may have crashed.           |
| Disk usage `/var/log/willbuy`   | > 80% of partition                 | Verify logrotate is running; manually rotate.     |

## Runbook steps

### Service logs are missing

1. Check the service is running: `systemctl status willbuy-<service>`
2. Confirm the log path exists: `ls -lh /var/log/willbuy/<service>.jsonl`
3. If the file is absent, restart the service and watch stderr for startup errors.
4. Confirm `WILLBUY_LOG_HASH_SALT` is set in the service environment (required in production).

### logrotate is not rotating

1. Run `logrotate -d /etc/logrotate.d/willbuy` (dry run) to see what it would do.
2. Check ownership — the log directory must be writable by the service user.
3. `copytruncate` requires the file is not opened with `O_APPEND` by pino. If
   pino's destination stream has `sync: true`, switch it off (default is `false`).

### Disk nearly full

1. Check current usage: `du -sh /var/log/willbuy/*`
2. Manually trigger rotation: `logrotate --force /etc/logrotate.d/willbuy`
3. If old compressed segments are accumulating, reduce `rotate` in
   `infra/observability/logrotate.conf` and re-deploy the conf.

### `log_payload_oversize` alert firing

1. Identify the source service and field from the alert's `field` key.
2. Find the call site in `apps/<service>/src/` that passes that field to
   the logger.
3. Either truncate the field before logging, or strip it via `REMOVE_FIELDS`
   in `packages/log/src/redactor.ts` if the field must never reach logs.
4. Add a redactor test confirming the field is stripped or truncated.
