/**
 * apps/visitor-worker/src/logger.ts — pre-built visitor-worker logger.
 *
 * Thin export of @willbuy/log's buildLogger() with `service: 'visitor-worker'`
 * baked in. Per issue #118 production writes JSONL to
 * /var/log/willbuy/visitor-worker.jsonl; logrotate handles 14-day retention.
 * The §5.12 redactor is applied to every log line.
 */
import { buildLogger as sharedBuildLogger } from '@willbuy/log';
import type { Logger } from 'pino';

export function buildVisitorWorkerLogger(): Logger {
  return sharedBuildLogger({ service: 'visitor-worker' });
}
