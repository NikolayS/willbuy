/**
 * Visitor Worker — CLI entrypoint.
 *
 * Production: started by systemd `ExecStart=/usr/bin/node dist/bin.js`.
 * Environment is injected from `/etc/willbuy/visitor-worker.env`.
 *
 * Reads:
 *   DATABASE_URL             — required; postgres connection string
 *   CAPTURE_STORAGE_PATH     — optional; default /tmp/willbuy/captures
 *   WILLBUY_LLM_BIN          — optional; LLM CLI binary (default: claude)
 *   WILLBUY_LLM_MODEL        — optional; model identity token
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { LocalCliProvider } from '@willbuy/llm-adapter';
import { runVisitorPollingLoop } from './poller.js';
import type { ObjectStorage } from './poller.js';

export type VisitorWorkerComponents = {
  pool: Pool;
  storage: ObjectStorage;
  provider: LocalCliProvider;
};

/**
 * Validate env and build the wiring components.
 * Throws if DATABASE_URL is missing.
 * Exported for unit testing.
 */
export function createVisitorWorker(env: NodeJS.ProcessEnv): VisitorWorkerComponents {
  const dbUrl = env['DATABASE_URL'];
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const captureBasePath = env['CAPTURE_STORAGE_PATH'] ?? '/tmp/willbuy/captures';

  const storage: ObjectStorage = {
    async get(key: string): Promise<Buffer> {
      return readFile(join(captureBasePath, key));
    },
    async has(key: string): Promise<boolean> {
      try {
        await stat(join(captureBasePath, key));
        return true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
    },
    async put(_key: string, _body: Buffer, _contentType: string): Promise<void> {
      throw new Error('visitor-worker storage is read-only');
    },
  };

  const pool = new Pool({ connectionString: dbUrl });
  const provider = new LocalCliProvider();

  return { pool, storage, provider };
}

// ── Process entrypoint ────────────────────────────────────────────────────────
// Guard: only execute when this file is the process entry point, not when
// imported by tests or other modules.

import { fileURLToPath } from 'node:url';

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    process.stderr.write('[willbuy-visitor-worker] DATABASE_URL is required\n');
    process.exit(1);
  }

  // Log only the host portion — never credentials.
  const hostOnly = (() => {
    try {
      return new URL(dbUrl).host;
    } catch {
      return '<unparseable>';
    }
  })();

  process.stdout.write(`[willbuy-visitor-worker] starting on DATABASE_URL=${hostOnly}\n`);

  const { pool, storage, provider } = createVisitorWorker(process.env);

  const controller = new AbortController();

  const loopPromise = runVisitorPollingLoop({ pool, storage, provider, signal: controller.signal });

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`[willbuy-visitor-worker] ${signal} received, shutting down\n`);
    controller.abort();
    await loopPromise;
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
