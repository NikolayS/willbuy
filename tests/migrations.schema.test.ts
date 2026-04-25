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
         insert into visits (study_id, backstory_id, variant_idx, status, repair_generation, transport_attempts, started_at)
           select s.id, b.id, 0, 'unknown_terminal', 0, 0, now()
           from backstories b join studies s on s.id = b.study_id
           where s.account_id = (select id from accounts where owner_email='enum4@example.com');`,
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
        `insert into visits (study_id, backstory_id, variant_idx, status, repair_generation, transport_attempts, started_at)
           values (999999, 999999, 0, 'started', 0, 0, now());`,
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

    it('visits (study_id, backstory_id, variant_idx) unique', () => {
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
        `insert into visits (study_id, backstory_id, variant_idx, status, repair_generation, transport_attempts, started_at)
           select s.id, b.id, 0, 'started', 0, 0, now()
           from backstories b join studies s on s.id = b.study_id
           where s.account_id = (select id from accounts where owner_email='uniq4@example.com');`,
      );
      expect(seed.code, `seed: ${seed.stderr}`).toBe(0);
      expectSqlError(
        pg.container,
        `insert into visits (study_id, backstory_id, variant_idx, status, repair_generation, transport_attempts, started_at)
           select s.id, b.id, 0, 'started', 0, 0, now()
           from backstories b join studies s on s.id = b.study_id
           where s.account_id = (select id from accounts where owner_email='uniq4@example.com');`,
        /duplicate key value violates unique/i,
        'visits (study_id, backstory_id, variant_idx) unique',
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

  // ── PR #46 review findings ─────────────────────────────────────────────────
  // Tests added RED (before migration fixes) per TDD red→green discipline.
  // Blocking: B1 visits columns, B2 credit_ledger.provider_attempt_id,
  //           B3 reports columns, B4 backstory_leases.holder_visit_id.
  // Non-blocking: NB5 studies comment, NB6 provider column comments.
  // Spec refs: §4.3, §5.4, §5.18, §2 #19.

  describe('PR-46 B1 — visits extended columns (spec §4.3)', () => {
    it('visits has study_id int8 column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='study_id';`,
        'visits.study_id type',
      );
      expect(out).toBe('bigint');
    });

    it('visits has capture_id int8 column (FK to page_captures)', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='capture_id';`,
        'visits.capture_id type',
      );
      expect(out).toBe('bigint');
    });

    it('visits has variant_idx int4 column (replaces side for spec §4.3 UNIQUE)', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='variant_idx';`,
        'visits.variant_idx type',
      );
      expect(out).toBe('integer');
    });

    it('visits has provider text column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='provider';`,
        'visits.provider type',
      );
      expect(out).toBe('text');
    });

    it('visits has model text column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='model';`,
        'visits.model type',
      );
      expect(out).toBe('text');
    });

    it('visits has cost_cents int4 column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='cost_cents';`,
        'visits.cost_cents type',
      );
      expect(out).toBe('integer');
    });

    it('visits has terminal_reason text column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='terminal_reason';`,
        'visits.terminal_reason type',
      );
      expect(out).toBe('text');
    });

    it('visits has latency_ms int4 column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='visits' and column_name='latency_ms';`,
        'visits.latency_ms type',
      );
      expect(out).toBe('integer');
    });

    it('visits UNIQUE is (study_id, backstory_id, variant_idx) — spec §4.3', () => {
      // Confirm the new triple-key unique exists by querying pg_indexes.
      const out = expectSqlOk(
        pg.container,
        `select count(*) from pg_indexes
         where tablename='visits'
           and indexdef like '%study_id%backstory_id%variant_idx%';`,
        'visits UNIQUE(study_id, backstory_id, variant_idx)',
      );
      expect(out).toBe('1');
    });

    it('visits.capture_id FK rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('b1fk@example.com');
         insert into studies (account_id, kind, status)
           select id, 'single', 'pending' from accounts where owner_email='b1fk@example.com';
         insert into backstories (study_id, idx, payload)
           select id, 0, '{}'::jsonb from studies
           where account_id=(select id from accounts where owner_email='b1fk@example.com');
         insert into visits (study_id, backstory_id, variant_idx, capture_id, provider, model, status, repair_generation, transport_attempts, started_at)
           select s.id, b.id, 0, 999999, 'anthropic', 'claude-haiku-4-5', 'started', 0, 0, now()
           from backstories b
           join studies s on s.id = b.study_id
           where s.account_id=(select id from accounts where owner_email='b1fk@example.com');`,
        /violates foreign key constraint/i,
        'visits.capture_id FK',
      );
    });

    it('visits.study_id FK rejects missing parent', () => {
      expectSqlError(
        pg.container,
        `insert into accounts (owner_email) values ('b1sfk@example.com');
         insert into studies (account_id, kind, status)
           select id, 'single', 'pending' from accounts where owner_email='b1sfk@example.com';
         insert into backstories (study_id, idx, payload)
           select id, 0, '{}'::jsonb from studies
           where account_id=(select id from accounts where owner_email='b1sfk@example.com');
         insert into visits (study_id, backstory_id, variant_idx, provider, model, status, repair_generation, transport_attempts, started_at)
           select 999999, b.id, 0, 'anthropic', 'claude-haiku-4-5', 'started', 0, 0, now()
           from backstories b
           join studies s on s.id = b.study_id
           where s.account_id=(select id from accounts where owner_email='b1sfk@example.com');`,
        /violates foreign key constraint/i,
        'visits.study_id FK',
      );
    });
  });

  describe('PR-46 B2 — credit_ledger.provider_attempt_id FK (spec §4.3/§5.4)', () => {
    it('credit_ledger has provider_attempt_id int8 column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='credit_ledger' and column_name='provider_attempt_id';`,
        'credit_ledger.provider_attempt_id type',
      );
      expect(out).toBe('bigint');
    });

    it('credit_ledger.provider_attempt_id FK rejects missing parent', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2fk@example.com');`);
      expectSqlError(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select id, 999999, 'commit', -5, 'b2fk-commit-1' from accounts where owner_email='b2fk@example.com';`,
        /violates foreign key constraint/i,
        'credit_ledger.provider_attempt_id FK',
      );
    });

    it('credit_ledger.provider_attempt_id accepts NULL (reserve rows have no attempt yet)', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2null@example.com');`);
      const r = psql(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select id, null, 'reserve', -100, 'b2null-reserve-1' from accounts where owner_email='b2null@example.com';`,
      );
      expect(r.code, `NULL provider_attempt_id rejected: ${r.stderr}`).toBe(0);
    });
  });

  describe('PR-46 B3 — reports extended columns (spec §4.3, §5.18, §2 #19)', () => {
    it('reports has clusters_json jsonb column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='reports' and column_name='clusters_json';`,
        'reports.clusters_json type',
      );
      expect(out).toBe('jsonb');
    });

    it('reports has scores_json jsonb column', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='reports' and column_name='scores_json';`,
        'reports.scores_json type',
      );
      expect(out).toBe('jsonb');
    });

    it('reports has paired_tests_disagreement boolean column (spec §2 #19 banner)', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='reports' and column_name='paired_tests_disagreement';`,
        'reports.paired_tests_disagreement type',
      );
      expect(out).toBe('boolean');
    });

    it('reports has default_share_token_id int8 column (FK to future share_tokens)', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='reports' and column_name='default_share_token_id';`,
        'reports.default_share_token_id type',
      );
      expect(out).toBe('bigint');
    });

    it('reports.paired_tests_disagreement accepts true/false (typed boolean)', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b3bool@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'paired', 'aggregating' from accounts where owner_email='b3bool@example.com';`,
      );
      const r = psql(
        pg.container,
        `insert into reports (study_id, share_token_hash, conv_score, paired_delta_json, paired_tests_disagreement, ready_at)
           select id, 'tok-b3bool', 0.5, '{}'::jsonb, true, now() from studies
           where account_id=(select id from accounts where owner_email='b3bool@example.com');`,
      );
      expect(r.code, `boolean insert: ${r.stderr}`).toBe(0);
      const out = expectSqlOk(
        pg.container,
        `select paired_tests_disagreement from reports
           where study_id=(select id from studies where account_id=(select id from accounts where owner_email='b3bool@example.com'));`,
        'reports.paired_tests_disagreement value',
      );
      expect(out).toBe('t');
    });
  });

  describe('PR-46 B4 — backstory_leases.holder_visit_id typed FK (spec §4.3)', () => {
    it('backstory_leases has holder_visit_id int8 column (not text lease_owner)', () => {
      const out = expectSqlOk(
        pg.container,
        `select data_type from information_schema.columns where table_name='backstory_leases' and column_name='holder_visit_id';`,
        'backstory_leases.holder_visit_id type',
      );
      expect(out).toBe('bigint');
    });

    it('backstory_leases.holder_visit_id FK rejects missing parent', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b4fk@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'paired', 'visiting' from accounts where owner_email='b4fk@example.com';`,
      );
      psql(
        pg.container,
        `insert into backstories (study_id, idx, payload) select id, 0, '{}'::jsonb from studies where account_id=(select id from accounts where owner_email='b4fk@example.com');`,
      );
      expectSqlError(
        pg.container,
        `insert into backstory_leases (backstory_id, study_id, holder_visit_id, lease_until, heartbeat_at)
           select b.id, s.id, 999999, now()+interval '120s', now()
           from backstories b join studies s on s.id=b.study_id
           where s.account_id=(select id from accounts where owner_email='b4fk@example.com');`,
        /violates foreign key constraint/i,
        'backstory_leases.holder_visit_id FK',
      );
    });

    it('backstory_leases no longer has lease_owner text column', () => {
      const out = expectSqlOk(
        pg.container,
        `select count(*) from information_schema.columns where table_name='backstory_leases' and column_name='lease_owner';`,
        'lease_owner should be absent',
      );
      // lease_owner was the old text column — should be gone after B4 fix
      expect(out).toBe('0');
    });
  });

  describe('PR-46 NB6 — comment on column for provider_circuit_state.provider and rate_tokens.provider', () => {
    it('provider_circuit_state.provider has a column comment', () => {
      const out = expectSqlOk(
        pg.container,
        `select count(*) from pg_description d
           join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
           join pg_class c on c.oid = a.attrelid
           where c.relname = 'provider_circuit_state' and a.attname = 'provider'
             and d.description is not null;`,
        'provider_circuit_state.provider comment',
      );
      expect(out).toBe('1');
    });

    it('rate_tokens.provider has a column comment', () => {
      const out = expectSqlOk(
        pg.container,
        `select count(*) from pg_description d
           join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
           join pg_class c on c.oid = a.attrelid
           where c.relname = 'rate_tokens' and a.attname = 'provider'
             and d.description is not null;`,
        'rate_tokens.provider comment',
      );
      expect(out).toBe('1');
    });
  });

  describe('PR-46 B2 (partial) — credit_ledger CHECK: commit/refund require provider_attempt_id NOT NULL (spec §5.4)', () => {
    it('inserting kind=commit with provider_attempt_id=NULL is rejected (CHECK violation)', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2check-commit@example.com');`);
      expectSqlError(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select id, null, 'commit', -5, 'b2check-commit-1' from accounts where owner_email='b2check-commit@example.com';`,
        /violates check constraint/i,
        'commit with NULL provider_attempt_id must be rejected',
      );
    });

    it('inserting kind=refund with provider_attempt_id=NULL is rejected (CHECK violation)', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2check-refund@example.com');`);
      expectSqlError(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select id, null, 'refund', 50, 'b2check-refund-1' from accounts where owner_email='b2check-refund@example.com';`,
        /violates check constraint/i,
        'refund with NULL provider_attempt_id must be rejected',
      );
    });

    it('inserting kind=reserve with provider_attempt_id=NULL succeeds (reserve precedes any attempt)', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2check-reserve@example.com');`);
      const r = psql(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select id, null, 'reserve', -100, 'b2check-reserve-1' from accounts where owner_email='b2check-reserve@example.com';`,
      );
      expect(r.code, `reserve with NULL provider_attempt_id should be accepted: ${r.stderr}`).toBe(0);
    });

    it('inserting kind=top_up with provider_attempt_id=NULL succeeds (Stripe webhook — no provider attempt)', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2check-topup@example.com');`);
      const r = psql(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select id, null, 'top_up', 1000, 'b2check-topup-1' from accounts where owner_email='b2check-topup@example.com';`,
      );
      expect(r.code, `top_up with NULL provider_attempt_id should be accepted: ${r.stderr}`).toBe(0);
    });

    it('inserting kind=commit with a valid provider_attempt_id succeeds', () => {
      psql(pg.container, `insert into accounts (owner_email) values ('b2check-ok@example.com');`);
      psql(
        pg.container,
        `insert into studies (account_id, kind, status) select id, 'single', 'pending' from accounts where owner_email='b2check-ok@example.com';`,
      );
      psql(
        pg.container,
        `insert into provider_attempts (account_id, study_id, kind, logical_request_key, provider, model, transport_attempts, status, cost_cents, started_at)
           select a.id, s.id, 'visit', 'b2check-ok-lk', 'anthropic', 'claude-haiku-4-5', 0, 'ended', 50, now()
           from accounts a join studies s on s.account_id = a.id where a.owner_email='b2check-ok@example.com';`,
      );
      const r = psql(
        pg.container,
        `insert into credit_ledger (account_id, provider_attempt_id, kind, cents, idempotency_key)
           select a.id, pa.id, 'commit', -50, 'b2check-ok-commit-1'
           from accounts a
           join provider_attempts pa on pa.account_id = a.id
           where a.owner_email='b2check-ok@example.com';`,
      );
      expect(r.code, `commit with valid provider_attempt_id should be accepted: ${r.stderr}`).toBe(0);
    });
  });
});
