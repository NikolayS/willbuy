/**
 * tests/helpers/start-postgres.ts
 *
 * Shared testcontainer helper for all Postgres-backed test suites.
 *
 * Extracted from tests/migrations.test.ts (PR #60) so that
 * tests/migrations.test.ts, tests/migrations.schema.test.ts, AND
 * apps/api/test/atomic-spend.test.ts (PR #60 fix — this PR) all use
 * the same wait-for-log strategy, eliminating the startup race where
 * pg_isready returns 0 during initdb before the postmaster accepts SQL.
 *
 * Usage:
 *   import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
 *
 * Returns { container, port, url } once Postgres is truly ready.
 */

import { spawnSync } from 'node:child_process';

const PG_IMAGE = 'postgres:16-alpine';
export const PG_PASSWORD = 'willbuy_test_pw';

function dockerRun(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function findFreePort(): number {
  return 30000 + Math.floor(Math.random() * 30000);
}

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export interface PostgresHandle {
  container: string;
  port: number;
  url: string;
}

/**
 * Start an ephemeral postgres:16-alpine container and wait until it is
 * genuinely ready to accept connections.
 *
 * Wait strategy (matches PR #60):
 *   1. Poll `docker logs` for "database system is ready to accept connections"
 *      — this fires only after initdb + WAL recovery, not mid-startup.
 *   2. Belt-and-suspenders: confirm `pg_isready` succeeds after the log line.
 *
 * @param containerPrefix  Prefix for the container name (default "willbuy-pg-test-")
 * @param dbName           Postgres DB name to include in the URL (default "postgres")
 * @param password         Postgres password (default PG_PASSWORD constant)
 * @param timeoutMs        Max wait time in ms (default 60 000)
 */
export async function startPostgres(opts?: {
  containerPrefix?: string;
  dbName?: string;
  password?: string;
  timeoutMs?: number;
}): Promise<PostgresHandle> {
  const containerPrefix = opts?.containerPrefix ?? 'willbuy-pg-test-';
  const dbName = opts?.dbName ?? 'postgres';
  const password = opts?.password ?? PG_PASSWORD;
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  const container = containerPrefix + uid();
  let port = findFreePort();
  let attempts = 0;
  let started = false;
  let lastErr = '';

  while (attempts < 3 && !started) {
    const dockerArgs = [
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      // Faster startup: trust-mode skips md5 auth handshake during initdb.
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-e', 'POSTGRES_INITDB_ARGS=--auth-host=trust',
      // Smaller shared-memory footprint; avoids OOM under CI memory pressure.
      '--shm-size=256m',
    ];
    // Optionally create a named database (otherwise defaults to "postgres").
    if (dbName !== 'postgres') {
      dockerArgs.push('-e', `POSTGRES_DB=${dbName}`);
    }
    dockerArgs.push('-p', `${port}:5432`, PG_IMAGE);
    const r = dockerRun(dockerArgs);
    if (r.code === 0) {
      started = true;
    } else {
      lastErr = r.stderr;
      port = findFreePort();
      attempts += 1;
    }
  }

  if (!started) {
    throw new Error(`failed to start postgres container: ${lastErr}`);
  }

  // Wait strategy (two-stage):
  //
  // Stage 1: Poll `docker logs` for the canonical "database system is ready
  // to accept connections" line.  This fires only after initdb + WAL recovery
  // completes, eliminating the race where pg_isready returns 0 mid-startup
  // but before the postmaster actually accepts SQL.
  //
  // Stage 2: After the log line appears, confirm the TCP port is accepting
  // connections from the HOST (not from inside the container via docker exec).
  // docker exec pg_isready talks over the Unix socket, which is ready slightly
  // before the host-side NAT port mapping propagates.  Using pg_isready with
  // -h 127.0.0.1 -p <port> confirms the mapped port is up for external callers.
  const deadline = Date.now() + timeoutMs;
  let logSeen = false;
  while (Date.now() < deadline) {
    if (!logSeen) {
      const logs = dockerRun(['logs', container]);
      const combined = logs.stdout + logs.stderr;
      if (combined.includes('database system is ready to accept connections')) {
        logSeen = true;
      }
    }
    if (logSeen) {
      // Confirm the TCP port is genuinely accepting SQL queries from the HOST.
      //
      // We use `psql -c 'SELECT 1'` rather than `pg_isready` because
      // pg_isready (including `docker exec pg_isready`) only tests that the
      // Unix socket / TCP listener is up — it does NOT verify that the
      // postmaster is ready to execute queries.  On macOS Docker Desktop the
      // host-side NAT port mapping can propagate slightly after the container's
      // internal listener is up, causing a race where pg_isready returns 0 but
      // the next psql call (from migrate.sh) gets "server closed the connection
      // unexpectedly".  A successful SELECT 1 proves the whole stack is ready.
      const url = `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`;
      const probe = spawnSync('psql', [url, '-c', 'SELECT 1', '--no-psqlrc', '-q'], {
        encoding: 'utf8',
      });
      // probe.status === null means psql binary not found (ENOENT); fall back
      // to docker-exec pg_isready so CI environments without a psql client
      // still work.
      if (probe.status === 0) {
        return { container, port, url };
      } else if (probe.status === null) {
        // psql not installed — fall back to docker exec pg_isready (less precise
        // but better than hanging until timeout).
        const fallback = dockerRun(['exec', container, 'pg_isready', '-U', 'postgres']);
        if (fallback.code === 0) {
          return { container, port, url };
        }
      }
    }
    await new Promise((res) => setTimeout(res, 300));
  }

  dockerRun(['rm', '-f', container]);
  throw new Error(`postgres container did not become ready in ${timeoutMs}ms`);
}

/** Remove the container started by startPostgres. */
export function stopPostgres(container: string): void {
  dockerRun(['rm', '-f', container]);
}
