import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Schema migration assertions for issue #26.
 *
 * Spec refs: §4.1 (canonical table list), §5.5 (atomic spend reservation),
 * §5.11 (single-writer finalize + late_arrivals), §5.13 (page_captures shape),
 * §5.14 (global_inflight + provider_circuit_state + rate_tokens),
 * §5.15 (provider_attempts logical_request_key), §2 #16 (unified provider-attempt ledger).
 *
 * Each test exercises one acceptance criterion from issue #26 against an
 * ephemeral postgres container provisioned via the existing migrations
 * runner from PR #38. Tests are skipped when docker is unavailable so the
 * suite still passes on hosts without docker.
 */

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
const CONTAINER_PREFIX = 'willbuy-schema-test-';

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function dockerRun(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function findFreePort(): number {
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
      '-e',
      `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-p',
      `${port}:5432`,
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

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = dockerRun(['exec', container, 'pg_isready', '-U', 'postgres']);
    if (r.code === 0) {
      const url = `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${port}/postgres`;
      return { container, port, url };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  dockerRun(['rm', '-f', container]);
  throw new Error('postgres container did not become ready in 30s');
}

function stopPostgres(container: string): void {
  dockerRun(['rm', '-f', container]);
}

function runMigrate(databaseUrl: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MIGRATIONS_DIR: realMigrationsDir,
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

function expectSqlError(
  container: string,
  sql: string,
  matcher: RegExp,
  hint: string,
): void {
  const r = psql(container, sql);
  expect(r.code, `${hint}: expected non-zero exit, got stdout=${r.stdout}`).not.toBe(0);
  expect(r.stderr, `${hint}: stderr did not match ${matcher}`).toMatch(matcher);
}

function expectSqlOk(container: string, sql: string, hint: string): string {
  const r = psql(container, sql);
  expect(r.code, `${hint}: stderr=${r.stderr}`).toBe(0);
  return r.stdout.trim();
}

describeIfDocker('migrations schema (issue #26)', () => {
  let pg: { container: string; port: number; url: string };

  beforeAll(async () => {
    pg = await startPostgres();
    const r = runMigrate(pg.url);
    expect(r.code, `migrate stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
  }, 120_000);

  afterAll(() => {
    if (pg) stopPostgres(pg.container);
  });

  describe('table existence + column types', () => {
    const expectedTables = [
      'accounts',
      'api_keys',
      'studies',
      'page_captures',
      'backstories',
      'backstory_leases',
      'visits',
      'provider_attempts',
      'credit_ledger',
      'llm_spend_daily',
      'cap_warnings',
      'reports',
      'late_arrivals',
      'global_inflight',
      'provider_circuit_state',
      'rate_tokens',
    ];

    for (const t of expectedTables) {
      it(`table ${t} exists in public schema`, () => {
        const out = expectSqlOk(
          pg.container,
          `select count(*) from information_schema.tables where table_schema = 'public' and table_name = '${t}';`,
          `table ${t}`,
        );
        expect(out).toBe('1');
      });
    }

    it('accounts.id is int8 identity', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type, is_identity from information_schema.columns where table_name='accounts' and column_name='id';`,
        'accounts.id',
      );
      expect(out).toBe('bigint|YES');
    });

    it('studies has timestamptz created_at and finalized_at', () => {
      const out = expectSqlOk(
        pg.container,
        `select column_name || ':' || data_type from information_schema.columns
         where table_name='studies' and column_name in ('created_at','finalized_at')
         order by column_name;`,
        'studies timestamptz columns',
      );
      expect(out).toBe(
        ['created_at:timestamp with time zone', 'finalized_at:timestamp with time zone'].join('\n'),
      );
    });

    it('visits.parsed is jsonb', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='parsed';`,
        'visits.parsed',
      );
      expect(out).toBe('jsonb');
    });

    it('account_balance view exists', () => {
      const out = expectSqlOk(
        pg.container,
        `select count(*) from information_schema.views where table_schema='public' and table_name='account_balance';`,
        'account_balance view',
      );
      expect(out).toBe('1');
    });
  });

  describe('idempotent re-apply', () => {
    it('second migrate run is a no-op (table count unchanged)', () => {
      const before = expectSqlOk(
        pg.container,
        `select count(*) from information_schema.tables where table_schema='public';`,
        'pre-rerun count',
      );
      const r2 = runMigrate(pg.url);
      expect(r2.code, `r2 stderr=${r2.stderr}`).toBe(0);
      const after = expectSqlOk(
        pg.container,
        `select count(*) from information_schema.tables where table_schema='public';`,
        'post-rerun count',
      );
      expect(after).toBe(before);
    });
  });

  describe('enum constraint enforcement (forbidden value rejected)', () => {
    it('studies.kind rejects unknown value', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('enum1@example.com');`);
      expectSqlError(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'triple', 'pending' from accounts where owner_email='enum1@example.com';`,
        /invalid input value|violates check constraint|invalid kind/i,
        'studies.kind enum',
      );
    });

    it('studies.status rejects unknown value', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('enum2@example.com');
         insert into studies (account_id, kind, status) select id, 'single', 'galactic' from accounts where owner_email='enum2@example.com';`,
        /invalid input value|violates check constraint/i,
        'studies.status enum',
      );
    });

    it('page_captures.status rejects unknown value', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('enum3@example.com');
         insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='enum3@example.com';
         insert into page_captures (study_id, side, url_hash, a11y_storage_key, host_count, status)
           select id, null, repeat('a',64), 'k/x', 1, 'partial' from studies
           where account_id = (select id from accounts where owner_email='enum3@example.com');`,
        /invalid input value|violates check constraint/i,
        'page_captures.status enum',
      );
    });

    it('visits.status rejects unknown value', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('enum4@example.com');
         insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='enum4@example.com';
         insert into backstories (study_id, idx, payload) select id, 0, '{}'::jsonb from studies
           where account_id = (select id from accounts where owner_email='enum4@example.com');
         insert into visits (backstory_id, side, status, repair_generation, transport_attempts, started_at)
           select id, 'A', 'unknown_terminal', 0, 0, now() from backstories
           where study_id = (select id from studies where account_id = (select id from accounts where owner_email='enum4@example.com'));`,
        /invalid input value|violates check constraint/i,
        'visits.status enum',
      );
    });

    it('provider_attempts.kind rejects unknown value', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('enum5@example.com');
         insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='enum5@example.com';
         insert into provider_attempts (account_id, study_id, kind, logical_request_key, provider, model, transport_attempts, status, cost_cents, started_at)
           select a.id, s.id, 'unknown_kind', 'lk-x-1', 'anthropic', 'claude-haiku-4-5', 0, 'started', 0, now()
           from accounts a join studies s on s.account_id = a.id where a.owner_email='enum5@example.com';`,
        /invalid input value|violates check constraint/i,
        'provider_attempts.kind enum',
      );
    });

    it('credit_ledger.kind rejects unknown value', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('enum6@example.com');
         insert into credit_ledger (account_id, kind, cents, idempotency_key)
           select id, 'embezzle', 100, 'idem-enum6' from accounts where owner_email='enum6@example.com';`,
        /invalid input value|violates check constraint/i,
        'credit_ledger.kind enum',
      );
    });

    it('provider_circuit_state.state rejects unknown value', () => {
      expectSqlError(
        pg.container,
        `insert into provider_circuit_state (provider, state) values ('anthropic', 'broken');`,
        /invalid input value|violates check constraint/i,
        'provider_circuit_state.state enum',
      );
    });
  });

  describe('foreign-key enforcement (orphan rejected)', () => {
    it('api_keys.account_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into api_keys (account_id, key_hash, prefix) values (999999, 'h', 'sk_live_x');`,
        /violates foreign key constraint/i,
        'api_keys FK',
      );
    });

    it('studies.account_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into studies (account_id, kind, status) values (999999, 'single', 'pending');`,
        /violates foreign key constraint/i,
        'studies FK',
      );
    });

    it('page_captures.study_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into page_captures (study_id, side, url_hash, a11y_storage_key, host_count, status)
           values (999999, null, repeat('b',64), 'k/y', 1, 'ok');`,
        /violates foreign key constraint/i,
        'page_captures FK',
      );
    });

    it('backstories.study_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into backstories (study_id, idx, payload) values (999999, 0, '{}'::jsonb);`,
        /violates foreign key constraint/i,
        'backstories FK',
      );
    });

    it('visits.backstory_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into visits (backstory_id, side, status, repair_generation, transport_attempts, started_at)
           values (999999, 'A', 'started', 0, 0, now());`,
        /violates foreign key constraint/i,
        'visits FK',
      );
    });

    it('reports.study_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into reports (study_id, share_token_hash, conv_score, paired_delta_json, ready_at)
           values (999999, 'tokhash-fk', 0, '{}'::jsonb, now());`,
        /violates foreign key constraint/i,
        'reports FK',
      );
    });

    it('credit_ledger.account_id rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into credit_ledger (account_id, kind, cents, idempotency_key)
           values (999999, 'top_up', 100, 'idem-fk-1');`,
        /violates foreign key constraint/i,
        'credit_ledger FK',
      );
    });
  });

  describe('UNIQUE enforcement (duplicate rejected)', () => {
    it('api_keys.key_hash unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq1@example.com');`);
      const ok = psql(
        pg.container,
        `insert into api_keys (account_id, key_hash, prefix)
           select id, 'dup-hash', 'sk_live_a' from accounts where owner_email='uniq1@example.com';`,
      );
      expect(ok.code, `seed: ${ok.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into api_keys (account_id, key_hash, prefix)
           select id, 'dup-hash', 'sk_live_b' from accounts where owner_email='uniq1@example.com';`,
        /duplicate key value violates unique/i,
        'api_keys.key_hash unique',
      );
    });

    it('page_captures (study_id, side) unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq2@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'paired', 'pending' from accounts where owner_email='uniq2@example.com';`,
      );
      const seed = psql(
        pg.container,
        `insert into page_captures (study_id, side, url_hash, a11y_storage_key, host_count, status)
           select id, 'A', repeat('c',64), 'k/c', 1, 'ok' from studies
           where account_id = (select id from accounts where owner_email='uniq2@example.com');`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into page_captures (study_id, side, url_hash, a11y_storage_key, host_count, status)
           select id, 'A', repeat('d',64), 'k/d', 1, 'ok' from studies
           where account_id = (select id from accounts where owner_email='uniq2@example.com');`,
        /duplicate key value violates unique/i,
        'page_captures (study_id, side) unique',
      );
    });

    it('backstories (study_id, idx) unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq3@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='uniq3@example.com';`,
      );
      const seed = psql(
        pg.container,
        `insert into backstories (study_id, idx, payload)
           select id, 0, '{}'::jsonb from studies
           where account_id = (select id from accounts where owner_email='uniq3@example.com');`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into backstories (study_id, idx, payload)
           select id, 0, '{}'::jsonb from studies
           where account_id = (select id from accounts where owner_email='uniq3@example.com');`,
        /duplicate key value violates unique/i,
        'backstories (study_id, idx) unique',
      );
    });

    it('visits (backstory_id, side) unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq4@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'paired', 'pending' from accounts where owner_email='uniq4@example.com';`,
      );
      psql(
        pg.container,
        `insert into backstories (study_id, idx, payload)
           select id, 0, '{}'::jsonb from studies
           where account_id = (select id from accounts where owner_email='uniq4@example.com');`,
      );
      const seed = psql(
        pg.container,
        `insert into visits (backstory_id, side, status, repair_generation, transport_attempts, started_at)
           select id, 'A', 'started', 0, 0, now() from backstories
           where study_id = (select id from studies where account_id = (select id from accounts where owner_email='uniq4@example.com'));`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into visits (backstory_id, side, status, repair_generation, transport_attempts, started_at)
           select id, 'A', 'started', 0, 0, now() from backstories
           where study_id = (select id from studies where account_id = (select id from accounts where owner_email='uniq4@example.com'));`,
        /duplicate key value violates unique/i,
        'visits (backstory_id, side) unique',
      );
    });

    it('provider_attempts.logical_request_key unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq5@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='uniq5@example.com';`,
      );
      const seed = psql(
        pg.container,
        `insert into provider_attempts (account_id, study_id, kind, logical_request_key, provider, model, transport_attempts, status, cost_cents, started_at)
           select a.id, s.id, 'visit', 'lk-uniq5', 'anthropic', 'claude-haiku-4-5', 0, 'started', 0, now()
           from accounts a join studies s on s.account_id = a.id where a.owner_email='uniq5@example.com';`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into provider_attempts (account_id, study_id, kind, logical_request_key, provider, model, transport_attempts, status, cost_cents, started_at)
           select a.id, s.id, 'visit', 'lk-uniq5', 'anthropic', 'claude-haiku-4-5', 0, 'started', 0, now()
           from accounts a join studies s on s.account_id = a.id where a.owner_email='uniq5@example.com';`,
        /duplicate key value violates unique/i,
        'provider_attempts.logical_request_key unique',
      );
    });

    it('credit_ledger.idempotency_key unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq6@example.com');`);
      const seed = psql(
        pg.container,
        `insert into credit_ledger (account_id, kind, cents, idempotency_key)
           select id, 'top_up', 1000, 'idem-uniq6' from accounts where owner_email='uniq6@example.com';`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into credit_ledger (account_id, kind, cents, idempotency_key)
           select id, 'top_up', 1000, 'idem-uniq6' from accounts where owner_email='uniq6@example.com';`,
        /duplicate key value violates unique/i,
        'credit_ledger.idempotency_key unique',
      );
    });

    it('reports.study_id unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq7@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'aggregating' from accounts where owner_email='uniq7@example.com';`,
      );
      const seed = psql(
        pg.container,
        `insert into reports (study_id, share_token_hash, conv_score, paired_delta_json, ready_at)
           select id, 'tok-uniq7-a', 0.5, '{}'::jsonb, now() from studies
           where account_id = (select id from accounts where owner_email='uniq7@example.com');`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into reports (study_id, share_token_hash, conv_score, paired_delta_json, ready_at)
           select id, 'tok-uniq7-b', 0.7, '{}'::jsonb, now() from studies
           where account_id = (select id from accounts where owner_email='uniq7@example.com');`,
        /duplicate key value violates unique/i,
        'reports.study_id unique',
      );
    });

    it('reports.share_token_hash unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq8@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'aggregating' from accounts where owner_email='uniq8@example.com';`,
      );
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'aggregating' from accounts where owner_email='uniq8@example.com';`,
      );
      const seed = psql(
        pg.container,
        `insert into reports (study_id, share_token_hash, conv_score, paired_delta_json, ready_at)
           select id, 'shared-tok', 0.5, '{}'::jsonb, now() from studies
           where account_id = (select id from accounts where owner_email='uniq8@example.com')
           order by id asc limit 1;`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into reports (study_id, share_token_hash, conv_score, paired_delta_json, ready_at)
           select id, 'shared-tok', 0.5, '{}'::jsonb, now() from studies
           where account_id = (select id from accounts where owner_email='uniq8@example.com')
           order by id desc limit 1;`,
        /duplicate key value violates unique/i,
        'reports.share_token_hash unique',
      );
    });

    it('llm_spend_daily PK (account_id, date, kind) unique', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('uniq9@example.com');`);
      const seed = psql(
        pg.container,
        `insert into llm_spend_daily (account_id, date, kind, cents)
           select id, current_date, 'visit', 5 from accounts where owner_email='uniq9@example.com';`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into llm_spend_daily (account_id, date, kind, cents)
           select id, current_date, 'visit', 5 from accounts where owner_email='uniq9@example.com';`,
        /duplicate key value violates unique/i,
        'llm_spend_daily PK',
      );
    });

    it('global_inflight PK (kind) unique', () => {
      const seed = psql(
        pg.container,
        `insert into global_inflight (kind, count) values ('visit', 0);`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into global_inflight (kind, count) values ('visit', 0);`,
        /duplicate key value violates unique/i,
        'global_inflight PK',
      );
    });
  });

  describe('domain rules', () => {
    it('accounts: at most 2 active api_keys per account', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('cap@example.com');`);
      const a = psql(
        pg.container,
        `insert into api_keys (account_id, key_hash, prefix)
           select id, 'cap-h-1', 'sk_live_1' from accounts where owner_email='cap@example.com';`,
      );
      const b = psql(
        pg.container,
        `insert into api_keys (account_id, key_hash, prefix)
           select id, 'cap-h-2', 'sk_live_2' from accounts where owner_email='cap@example.com';`,
      );
      expect(a.code, `seed1: ${a.stderr}`).toBe(0);
      expect(b.code, `seed2: ${b.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into api_keys (account_id, key_hash, prefix)
           select id, 'cap-h-3', 'sk_live_3' from accounts where owner_email='cap@example.com';`,
        /more than 2 active|too many active|active key|api_keys/i,
        'api_keys ≤2 active per account',
      );
    });

    it('credit_ledger.kind accepts the v0.1 set', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('cl-kind@example.com');`);
      const kinds = ['top_up', 'reserve', 'commit', 'refund', 'partial_finalize'];
      for (let i = 0; i < kinds.length; i++) {
        const r = psql(
          pg.container,
          `insert into credit_ledger (account_id, kind, cents, idempotency_key)
             select id, '${kinds[i]}', 100, 'cl-kind-${i}' from accounts where owner_email='cl-kind@example.com';`,
        );
        expect(r.code, `kind ${kinds[i]}: ${r.stderr}`).toBe(0);
      }
    });

    it('provider_attempts.status accepts the v0.1 set', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('pa-status@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='pa-status@example.com';`,
      );
      const statuses = ['started', 'ended', 'indeterminate', 'indeterminate_refunded'];
      for (let i = 0; i < statuses.length; i++) {
        const r = psql(
          pg.container,
          `insert into provider_attempts (account_id, study_id, kind, logical_request_key, provider, model, transport_attempts, status, cost_cents, started_at)
             select a.id, s.id, 'visit', 'pa-status-${i}', 'anthropic', 'claude-haiku-4-5', 0, '${statuses[i]}', 0, now()
             from accounts a join studies s on s.account_id = a.id where a.owner_email='pa-status@example.com';`,
        );
        expect(r.code, `status ${statuses[i]}: ${r.stderr}`).toBe(0);
      }
    });

    it('account_balance view sums signed ledger entries', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('bal@example.com');`);
      const ops = [
        { kind: 'top_up', cents: 1000 },
        { kind: 'reserve', cents: -200 },
        { kind: 'refund', cents: 50 },
      ];
      for (let i = 0; i < ops.length; i++) {
        const r = psql(
          pg.container,
          `insert into credit_ledger (account_id, kind, cents, idempotency_key)
             select id, '${ops[i]!.kind}', ${ops[i]!.cents}, 'bal-${i}' from accounts where owner_email='bal@example.com';`,
        );
        expect(r.code, r.stderr).toBe(0);
      }
      const balance = expectSqlOk(
        pg.container,
        `select balance_cents from account_balance where account_id = (select id from accounts where owner_email='bal@example.com');`,
        'account_balance',
      );
      expect(balance).toBe('850');
    });
  });
});
