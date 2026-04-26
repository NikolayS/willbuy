// apps/visitor-worker/test/poller.test.ts
//
// Unit tests for pollVisitorOnce (issue #158).
//
// These tests use an in-memory fake pool and an in-memory storage double so
// they run without Docker or a live Postgres instance. The pool fake
// intercepts every query string and returns scripted results.

import { describe, expect, it } from 'vitest';

import { pollVisitorOnce } from '../src/poller.js';
import type { PollVisitorOpts, ObjectStorage } from '../src/poller.js';
import { MockProvider } from './helpers/mockProvider.js';
import {
  SAMPLE_BACKSTORY,
  VALID_VISITOR_OUTPUT,
  validVisitorJsonString,
} from './helpers/fixtures.js';

// ─── In-memory storage double ────────────────────────────────────────────────

function buildStorage(initial: Record<string, string> = {}): ObjectStorage {
  const store = new Map<string, Buffer>(
    Object.entries(initial).map(([k, v]) => [k, Buffer.from(v, 'utf8')]),
  );
  return {
    async get(key) {
      const b = store.get(key);
      if (!b) throw new Error(`storage: key not found: ${key}`);
      return b;
    },
    async put(key, body) {
      store.set(key, Buffer.from(body));
    },
    async has(key) {
      return store.has(key);
    },
  };
}

// ─── Fake pg Pool / PoolClient ────────────────────────────────────────────────
//
// The fake intercepts query strings via pattern matching and returns scripted
// rows. Each test builds its own script so patterns are scoped per scenario.

type QueryRow = Record<string, string | null | number>;

interface QueryScript {
  /** Substring or RegExp that must match the SQL string. */
  match: string | RegExp;
  /** Rows to return (empty means rowCount=0, rows=[]). */
  rows: QueryRow[];
}

interface FakePoolOpts {
  /**
   * Scripts are matched in order; first match wins. Unmatched queries
   * return { rows: [], rowCount: 0 } which is the benign default for
   * BEGIN/COMMIT/ROLLBACK/SET/UPDATE statements.
   */
  scripts: QueryScript[];
  /** Called with every (sql, params) pair so tests can assert on side-effects. */
  onQuery?: (sql: string, params: unknown[] | undefined) => void;
}

function buildFakePool(opts: FakePoolOpts): import('pg').Pool {
  const makeClient = () => {
    const client = {
      async query(sql: string, params?: unknown[]) {
        opts.onQuery?.(sql, params);
        for (const script of opts.scripts) {
          const matched =
            typeof script.match === 'string'
              ? sql.includes(script.match)
              : script.match.test(sql);
          if (matched) {
            return { rows: script.rows, rowCount: script.rows.length };
          }
        }
        // Default: empty result (safe for BEGIN/COMMIT/SET/UPDATE)
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    return client;
  };

  return {
    async connect() {
      return makeClient() as unknown as import('pg').PoolClient;
    },
  } as unknown as import('pg').Pool;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_A11Y_KEY = 'a11y/study-1/capture-1.json';
const SAMPLE_A11Y_TEXT = 'a11y-tree: Pricing page. Tiers: hobby, starter, scale.';

function makeBackstoryPayload(): string {
  return JSON.stringify(SAMPLE_BACKSTORY);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pollVisitorOnce — empty queue', () => {
  it('returns { kind: "empty" } when no visits are pending', async () => {
    const pool = buildFakePool({
      // The lease query returns no rows → empty.
      scripts: [
        { match: 'FOR UPDATE OF v SKIP LOCKED', rows: [] },
      ],
    });

    const provider = new MockProvider({ responses: [] });
    const storage = buildStorage();

    const result = await pollVisitorOnce({
      pool,
      storage,
      provider,
    } satisfies PollVisitorOpts);

    expect(result.kind).toBe('empty');
    // Provider must never be called on an empty queue.
    expect(provider.calls).toHaveLength(0);
  });
});

describe('pollVisitorOnce — null a11y_object_key (no_snapshot)', () => {
  it('returns { kind: "processed", visitOk: false } with terminal_reason=no_snapshot', async () => {
    const queries: string[] = [];

    const pool = buildFakePool({
      scripts: [
        {
          match: 'FOR UPDATE OF v SKIP LOCKED',
          rows: [
            {
              id: '42',
              study_id: '7',
              backstory_payload: makeBackstoryPayload(),
              a11y_object_key: null,
            },
          ],
        },
        // maybeAdvanceStudy: no pending visits (all processed)
        { match: 'pending_count', rows: [{ pending_count: '0' }] },
      ],
      onQuery: (sql) => queries.push(sql),
    });

    const provider = new MockProvider({ responses: [] });
    const storage = buildStorage(); // empty — should not be accessed

    const result = await pollVisitorOnce({ pool, storage, provider });

    expect(result).toEqual({ kind: 'processed', visitId: 42, visitOk: false });
    // Provider must NOT be called.
    expect(provider.calls).toHaveLength(0);
    // terminal_reason update must have been issued.
    const terminalUpdate = queries.find((q) => q.includes('terminal_reason'));
    expect(terminalUpdate).toBeDefined();
    // Storage must not be accessed.
  });
});

describe('pollVisitorOnce — happy path', () => {
  it('calls runVisit, writes parsed/score/provider/model back, advances study', async () => {
    const queries: string[] = [];
    const updateParams: unknown[][] = [];

    const pool = buildFakePool({
      scripts: [
        {
          match: 'FOR UPDATE OF v SKIP LOCKED',
          rows: [
            {
              id: '99',
              study_id: '5',
              backstory_payload: makeBackstoryPayload(),
              a11y_object_key: SAMPLE_A11Y_KEY,
            },
          ],
        },
        // maybeAdvanceStudy pending check: 0 pending → study advances
        { match: 'pending_count', rows: [{ pending_count: '0' }] },
      ],
      onQuery: (sql, params) => {
        queries.push(sql);
        if (sql.includes('UPDATE visits') && params) {
          updateParams.push(params);
        }
      },
    });

    const provider = new MockProvider({
      responses: [
        { raw: validVisitorJsonString(), transportAttempts: 1, status: 'ok' },
      ],
    });
    const storage = buildStorage({ [SAMPLE_A11Y_KEY]: SAMPLE_A11Y_TEXT });

    const result = await pollVisitorOnce({ pool, storage, provider });

    expect(result).toEqual({ kind: 'processed', visitId: 99, visitOk: true });

    // Provider must have been called exactly once (happy path, no repair).
    expect(provider.calls).toHaveLength(1);

    // The UPDATE visits must contain the parsed output.
    const visitUpdate = queries.find((q) => q.includes('UPDATE visits') && q.includes('parsed'));
    expect(visitUpdate).toBeDefined();

    // Check that score (will_to_buy) was passed correctly.
    const updateParam = updateParams[0];
    expect(updateParam).toBeDefined();
    // First param is the parsed JSON string
    const parsedArg = JSON.parse(updateParam![0] as string);
    expect(parsedArg).toEqual(VALID_VISITOR_OUTPUT);
    // Second param is the score (will_to_buy = 7 from fixture)
    expect(updateParam![1]).toBe(VALID_VISITOR_OUTPUT.will_to_buy);
    // Third param is provider name
    expect(updateParam![2]).toBe(provider.name());
    // Fourth param is model name
    expect(updateParam![3]).toBe(provider.model());

    // Study advance UPDATE must have been issued.
    const studyUpdate = queries.find(
      (q) => q.includes('UPDATE studies') && q.includes('aggregating'),
    );
    expect(studyUpdate).toBeDefined();
  });
});

describe('pollVisitorOnce — LLM transport failure', () => {
  it('writes terminal_reason and visitOk=false when provider returns error', async () => {
    const queries: string[] = [];

    const pool = buildFakePool({
      scripts: [
        {
          match: 'FOR UPDATE OF v SKIP LOCKED',
          rows: [
            {
              id: '77',
              study_id: '3',
              backstory_payload: makeBackstoryPayload(),
              a11y_object_key: SAMPLE_A11Y_KEY,
            },
          ],
        },
        { match: 'pending_count', rows: [{ pending_count: '1' }] },
      ],
      onQuery: (sql) => queries.push(sql),
    });

    const provider = new MockProvider({
      responses: [{ raw: '', transportAttempts: 1, status: 'error' }],
    });
    const storage = buildStorage({ [SAMPLE_A11Y_KEY]: SAMPLE_A11Y_TEXT });

    const result = await pollVisitorOnce({ pool, storage, provider });

    expect(result).toEqual({ kind: 'processed', visitId: 77, visitOk: false });

    // Provider was called once.
    expect(provider.calls).toHaveLength(1);

    // terminal_reason update must have been issued (failure path: UPDATE visits SET terminal_reason=...).
    const terminalUpdate = queries.find(
      (q) => q.includes('UPDATE visits') && q.includes('terminal_reason'),
    );
    expect(terminalUpdate).toBeDefined();

    // Study must NOT have advanced (still 1 pending).
    const studyUpdate = queries.find(
      (q) => q.includes('UPDATE studies') && q.includes('aggregating'),
    );
    expect(studyUpdate).toBeUndefined();
  });
});

describe('pollVisitorOnce — study does not advance when visits still pending', () => {
  it('skips study UPDATE when pending_count > 0', async () => {
    const queries: string[] = [];

    const pool = buildFakePool({
      scripts: [
        {
          match: 'FOR UPDATE OF v SKIP LOCKED',
          rows: [
            {
              id: '55',
              study_id: '9',
              backstory_payload: makeBackstoryPayload(),
              a11y_object_key: SAMPLE_A11Y_KEY,
            },
          ],
        },
        // Still 2 pending visits after this one is processed
        { match: 'pending_count', rows: [{ pending_count: '2' }] },
      ],
      onQuery: (sql) => queries.push(sql),
    });

    const provider = new MockProvider({
      responses: [
        { raw: validVisitorJsonString(), transportAttempts: 1, status: 'ok' },
      ],
    });
    const storage = buildStorage({ [SAMPLE_A11Y_KEY]: SAMPLE_A11Y_TEXT });

    const result = await pollVisitorOnce({ pool, storage, provider });

    expect(result.kind).toBe('processed');
    if (result.kind === 'processed') {
      expect(result.visitOk).toBe(true);
    }

    const studyUpdate = queries.find(
      (q) => q.includes('UPDATE studies') && q.includes('aggregating'),
    );
    expect(studyUpdate).toBeUndefined();
  });
});
