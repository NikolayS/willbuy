import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPostgres, stopPostgres } from './helpers/start-postgres.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const migrateScript = resolve(repoRoot, 'scripts/migrate.sh');
const realMigrationsDir = resolve(repoRoot, 'infra/migrations');
const realSqleverDir = resolve(repoRoot, 'infra/sqlever');

const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

function runMigrate(opts: {
  databaseUrl: string;
  sqleverTopDir?: string;
}): { code: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: opts.databaseUrl,
  };
  if (opts.sqleverTopDir !== undefined) {
    env['SQLEVER_TOP_DIR'] = opts.sqleverTopDir;
  }
  const r = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    env,
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

/**
 * Build a temp sqlever project that mirrors the real infra/sqlever project
 * but adds extra deploy changes. Used by the failing-migration test to inject
 * a bad change without touching the committed project files.
 *
 * Layout of the temp project:
 *   <tmpDir>/sqitch.conf       — copy of real sqitch.conf
 *   <tmpDir>/sqitch.plan       — real plan + extra entries
 *   <tmpDir>/deploy/           — symlink copies of real deploy scripts + extra scripts
 */
function buildTempSqleverProject(
  extraChanges: Array<{ name: string; sql: string }>,
): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'willbuy-sqlever-test-'));
  mkdirSync(join(tmpDir, 'deploy'));
  mkdirSync(join(tmpDir, 'revert'));
  mkdirSync(join(tmpDir, 'verify'));

  // Copy sqitch.conf verbatim.
  copyFileSync(join(realSqleverDir, 'sqitch.conf'), join(tmpDir, 'sqitch.conf'));

  // Copy real deploy scripts.
  for (const f of readdirSync(join(realSqleverDir, 'deploy'))) {
    if (f.endsWith('.sql')) {
      copyFileSync(join(realSqleverDir, 'deploy', f), join(tmpDir, 'deploy', f));
    }
  }

  // Write extra deploy scripts.
  for (const { name, sql } of extraChanges) {
    writeFileSync(join(tmpDir, 'deploy', `${name}.sql`), sql, 'utf8');
  }

  // Build sqitch.plan: real plan lines + extra change entries.
  const realPlan = readFileSync(join(realSqleverDir, 'sqitch.plan'), 'utf8');
  // Find the last non-empty, non-comment line to extract the last change name
  // for the dependency chain of the extra changes.
  const planLines = realPlan.trimEnd().split('\n');
  const lastChangeLine = planLines.filter(
    (l) => l.trim() && !l.startsWith('%') && !l.startsWith('#'),
  ).at(-1) ?? '';
  const lastChangeName = lastChangeLine.split(/\s+/)[0] ?? '';

  const extraPlanLines = extraChanges.map(({ name }, i) => {
    const dep = i === 0 ? lastChangeName : extraChanges[i - 1]!.name;
    const depPart = dep ? `[${dep}] ` : '';
    return `${name} ${depPart}2026-04-25T12:00:0${i}Z willbuy <team@willbuy.dev> # test extra change`;
  });

  writeFileSync(
    join(tmpDir, 'sqitch.plan'),
    realPlan.trimEnd() + '\n' + extraPlanLines.join('\n') + '\n',
    'utf8',
  );

  return tmpDir;
}

describeIfDocker('migrations runner', () => {
  let pg: { container: string; port: number; url: string };
  let workDir: string;

  beforeAll(async () => {
    pg = await startPostgres({ containerPrefix: 'willbuy-migrate-test-' });
    workDir = mkdtempSync(join(tmpdir(), 'willbuy-mig-'));
  }, 60_000);

  afterAll(() => {
    if (pg) stopPostgres(pg.container);
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('applies every migration on a fresh DB', () => {
    const r = runMigrate({ databaseUrl: pg.url });
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
    const r1 = runMigrate({ databaseUrl: pg.url });
    expect(r1.code, `r1 stderr=${r1.stderr}`).toBe(0);

    const beforeRow = psql(pg.container, 'SELECT COUNT(*) FROM _migrations;');
    const beforeCount = Number(beforeRow.stdout.trim());

    const r2 = runMigrate({ databaseUrl: pg.url });
    expect(r2.code, `r2 stderr=${r2.stderr}`).toBe(0);

    const afterRow = psql(pg.container, 'SELECT COUNT(*) FROM _migrations;');
    const afterCount = Number(afterRow.stdout.trim());
    expect(afterCount).toBe(beforeCount);
  });

  it('rolls back a failing migration atomically and exits non-zero', () => {
    // Apply the real migrations first so the DB is fully migrated.
    const r1 = runMigrate({ databaseUrl: pg.url });
    expect(r1.code, `r1 stderr=${r1.stderr}`).toBe(0);

    // Build a temp sqlever project that adds a bad change on top of the real plan.
    // The bad change creates a table and then errors mid-way — sqlever wraps
    // each deploy script in a BEGIN/COMMIT so the partial change rolls back.
    const failingSql = [
      '-- failing fixture: creates a table, then errors mid-way',
      'BEGIN;',
      'CREATE TABLE willbuy_fail_fixture (id INT PRIMARY KEY);',
      'INSERT INTO willbuy_fail_fixture VALUES (1);',
      'SELECT 1 / 0;',
      'INSERT INTO _migrations (filename, checksum, applied_at)',
      "VALUES ('9999_fail_fixture.sql', 'sqlever-managed', NOW())",
      'ON CONFLICT (filename) DO NOTHING;',
      'COMMIT;',
    ].join('\n');

    const tmpSqleverDir = buildTempSqleverProject([
      { name: '9999_fail_fixture', sql: failingSql },
    ]);

    const r2 = runMigrate({ databaseUrl: pg.url, sqleverTopDir: tmpSqleverDir });
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

    rmSync(tmpSqleverDir, { recursive: true, force: true });
  });
});
