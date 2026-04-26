/**
 * apps/capture-broker/src/logger.ts — pre-built capture-broker logger.
 *
 * Thin export of @willbuy/log's buildLogger() with `service: 'capture-broker'`
 * baked in. Per issue #118 production writes JSONL to
 * /var/log/willbuy/capture-broker.jsonl; logrotate handles 14-day retention.
 * The §5.12 redactor is applied to every log line.
 */
import { buildLogger as sharedBuildLogger } from '@willbuy/log';
import type { Logger } from 'pino';

export function buildBrokerLogger(): Logger {
  return sharedBuildLogger({ service: 'capture-broker' });
}
