/**
 * index.ts — capture-worker library exports + production entrypoint.
 *
 * When imported as a module the exports below are available.
 * When run directly (`bun run src/index.ts`) the polling loop starts,
 * driven by DATABASE_URL + BROKER_SOCKET_PATH env vars.
 */

export { captureUrl } from './capture.js';
export { LAUNCH_FLAGS } from './launchFlags.js';
export type {
  A11yNode,
  BreachReason,
  CaptureOpts,
  CaptureResult,
  CaptureStatus,
} from './types.js';
export { CAPTURE_CEILINGS } from './types.js';
export { pollOnce, runPollingLoop } from './poller.js';
export { sendToBroker } from './broker-client.js';
export {
  RuntimeConfigError,
  RuntimeNotImplementedError,
  runCapture,
  selectRuntime,
  selectRuntimeFromEnv,
  type CaptureRuntime,
} from './runtime.js';

// ── production entrypoint ─────────────────────────────────────────────────────
// Only runs when this file is executed directly (not when imported).

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { Pool } = await import('pg');
  const { runPollingLoop: startLoop } = await import('./poller.js');
  const { buildCaptureWorkerLogger } = await import('./logger.js');
  const { selectRuntimeFromEnv, RuntimeConfigError } = await import(
    './runtime.js'
  );

  const log = buildCaptureWorkerLogger();

  // Validate WILLBUY_CAPTURE_RUNTIME at process-start (issue #116). A bad
  // value here aborts the worker BEFORE any visit row is leased — better to
  // crash-loop the deployment than to silently fall through to 'netns' or
  // produce one 'indeterminate' visit per misconfig before crashing.
  let captureRuntime: 'netns' | 'firecracker';
  try {
    captureRuntime = selectRuntimeFromEnv(process.env);
  } catch (e) {
    if (e instanceof RuntimeConfigError) {
      log.error({ event: 'startup.invalid_runtime', value: e.value }, e.message);
      process.exit(2);
    }
    throw e;
  }
  log.info(
    { event: 'startup.runtime', runtime: captureRuntime },
    `WILLBUY_CAPTURE_RUNTIME=${captureRuntime}` +
      (captureRuntime === 'firecracker'
        ? ' (stub seam — actual VM launch lands in #117)'
        : ''),
  );

  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    log.error({ event: 'startup.missing_env', var: 'DATABASE_URL' }, 'DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const brokerSocketPath = process.env['BROKER_SOCKET_PATH'];

  const ac = new AbortController();

  process.on('SIGTERM', () => {
    log.info({ event: 'shutdown.sigterm' }, 'SIGTERM — draining in-flight captures…');
    ac.abort();
    // Give in-flight captures 60 s to drain before forcing exit.
    setTimeout(() => process.exit(0), 60_000).unref();
  });
  process.on('SIGINT', () => ac.abort());

  log.info({ event: 'startup.polling_loop' }, 'starting polling loop');
  await startLoop({
    pool,
    signal: ac.signal,
    ...(brokerSocketPath !== undefined && { brokerSocketPath }),
  });
  await pool.end();
  log.info({ event: 'shutdown.drained' }, 'drained; exiting');
}
