import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const migrateScript = resolve(repoRoot, 'scripts/migrate.sh');
const realMigrationsDir = resolve(repoRoot, 'infra/migrations');

const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

const PG_IMAGE = 'postgres:16-alpine';
const PG_PASSWORD = 'willbuy_test_pw';
const CONTAINER_PREFIX = 'willbuy-migrate-test-';

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function dockerRun(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function findFreePort(): number {
  // Pick a random ephemeral port; let docker bind it. If conflict, retry once.
  return 30000 + Math.floor(Math.random() * 30000);
}

async function startPostgres(): Promise<{ container: string; port: number; url: string }> {
  const container = CONTAINER_PREFIX + uid();
  let port = findFreePort();
  let attempts = 0;
  let started = false;
  let lastErr = '';
  while (attempts < 3 && !started) {
    const r = dockerRun([
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      // Faster startup: trust-mode skips md5 auth handshake during initdb.
      '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-e', 'POSTGRES_INITDB_ARGS=--auth-host=trust',
      // Smaller footprint: 128 MB shared_buffers avoids OOM under CI memory pressure.
      '-e', 'POSTGRES_SHARED_BUFFERS=128MB',
      '--shm-size=256m',
      '-p', `${port}:5432`,
      PG_IMAGE,
    ]);
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

  // Wait strategy: first poll docker logs for the canonical "ready to accept connections"
  // line — this fires only after initdb + WAL recovery completes, eliminating the race
  // where pg_isready returns 0 during startup but before the postmaster accepts SQL.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = dockerRun(['logs', container]);
    const combined = logs.stdout + logs.stderr;
    if (combined.includes('database system is ready to accept connections')) {
      // Secondary sanity: confirm the port is actually accepting connections.
      const ready = dockerRun(['exec', container, 'pg_isready', '-U', 'postgres']);
      if (ready.code === 0) {
        const url = `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${port}/postgres`;
        return { container, port, url };
      }
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  dockerRun(['rm', '-f', container]);
  throw new Error('postgres container did not become ready in 60s');
}

function stopPostgres(container: string): void {
  dockerRun(['rm', '-f', container]);
}

function runMigrate(opts: {
  databaseUrl: string;
  migrationsDir: string;
}): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: opts.databaseUrl,
      MIGRATIONS_DIR: opts.migrationsDir,
    },
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function psql(container: string, sql: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql],
    { encoding: 'utf8' },
  );
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function copyRealMigrationsTo(dir: string): void {
  for (const f of readdirSync(realMigrationsDir)) {
    if (f.endsWith('.sql')) {
      copyFileSync(join(realMigrationsDir, f), join(dir, f));
    }
  }
}

describeIfDocker('migrations runner', () => {
  let pg: { container: string; port: number; url: string };
  let workDir: string;

  beforeAll(async () => {
    pg = await startPostgres();
    workDir = mkdtempSync(join(tmpdir(), 'willbuy-mig-'));
  }, 60_000);

  afterAll(() => {
    if (pg) stopPostgres(pg.container);
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('applies every migration on a fresh DB', () => {
    const dir = mkdtempSync(join(workDir, 'fresh-'));
    copyRealMigrationsTo(dir);

    const r = runMigrate({ databaseUrl: pg.url, migrationsDir: dir });
    expect(r.code, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);

    const tableCheck = psql(
      pg.container,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='_migrations';",
    );
    expect(tableCheck.code).toBe(0);
    expect(tableCheck.stdout.trim()).toBe('1');

    // _migrations row count must equal the .sql file count in real migrations dir.
    const onDisk = readdirSync(realMigrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const rowCount = psql(pg.container, 'SELECT COUNT(*) FROM _migrations;');
    expect(rowCount.code).toBe(0);
    expect(rowCount.stdout.trim()).toBe(String(onDisk.length));

    const filenames = psql(pg.container, 'SELECT filename FROM _migrations ORDER BY filename;');
    expect(filenames.stdout.trim().split('\n').sort()).toEqual(onDisk);
  });

  it('is a no-op on second run', () => {
    const dir = mkdtempSync(join(workDir, 'reapply-'));
    copyRealMigrationsTo(dir);

    const r1 = runMigrate({ databaseUrl: pg.url, migrationsDir: dir });
    expect(r1.code, `r1 stderr=${r1.stderr}`).toBe(0);

    const beforeRow = psql(pg.container, 'SELECT COUNT(*) FROM _migrations;');
    const beforeCount = Number(beforeRow.stdout.trim());

    const r2 = runMigrate({ databaseUrl: pg.url, migrationsDir: dir });
    expect(r2.code, `r2 stderr=${r2.stderr}`).toBe(0);

    const afterRow = psql(pg.container, 'SELECT COUNT(*) FROM _migrations;');
    const afterCount = Number(afterRow.stdout.trim());
    expect(afterCount).toBe(beforeCount);
  });

  it('rolls back a failing migration atomically and exits non-zero', () => {
    const dir = mkdtempSync(join(workDir, 'fail-'));
    mkdirSync(dir, { recursive: true });
    copyRealMigrationsTo(dir);

    // Apply the placeholder first so we are testing add-on of a failing fixture.
    const r1 = runMigrate({ databaseUrl: pg.url, migrationsDir: dir });
    expect(r1.code, `r1 stderr=${r1.stderr}`).toBe(0);

    const failingSql = [
      '-- failing fixture: creates a table, then errors mid-way',
      'CREATE TABLE willbuy_fail_fixture (id INT PRIMARY KEY);',
      'INSERT INTO willbuy_fail_fixture VALUES (1);',
      'SELECT 1 / 0;',
    ].join('\n');
    writeFileSync(join(dir, '9999_fail_fixture.sql'), failingSql);

    const r2 = runMigrate({ databaseUrl: pg.url, migrationsDir: dir });
    expect(r2.code).not.toBe(0);

    // Partial change rolled back: the table from the failing migration must NOT exist.
    const tableCheck = psql(
      pg.container,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='willbuy_fail_fixture';",
    );
    expect(tableCheck.code).toBe(0);
    expect(tableCheck.stdout.trim()).toBe('0');

    // _migrations must NOT mark the failing fixture as applied.
    const recorded = psql(
      pg.container,
      "SELECT COUNT(*) FROM _migrations WHERE filename='9999_fail_fixture.sql';",
    );
    expect(recorded.code).toBe(0);
    expect(recorded.stdout.trim()).toBe('0');
  });
});
