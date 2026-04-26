/**
 * apps/capture-worker/src/logger.ts — pre-built capture-worker logger.
 *
 * Thin export of @willbuy/log's buildLogger() with `service: 'capture-worker'`
 * baked in. Per issue #118 production writes JSONL to
 * /var/log/willbuy/capture-worker.jsonl; logrotate handles 14-day retention.
 * The §5.12 redactor is applied to every log line.
 */
import { buildLogger as sharedBuildLogger } from '@willbuy/log';
import type { Logger } from 'pino';

export function buildCaptureWorkerLogger(): Logger {
  return sharedBuildLogger({ service: 'capture-worker' });
}
