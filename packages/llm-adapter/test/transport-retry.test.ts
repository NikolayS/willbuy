// Issue #27 (spec §5.15, §2 #15) — LLMProvider transport retry +
// logical_request_key idempotency.
//
// Six acceptance scenarios from the issue body:
//   1. 137 / 137 / 0  → ok with transportAttempts=3
//   2. 137 / 137 / 137 → error with transportAttempts=3
//   3. exit 1 + non-empty stderr ("bad json") → error immediately, attempts=1
//      (non_transient — no retry)
//   4. Same logicalRequestKey is forwarded as WILLBUY_REQ_KEY on EVERY
//      transport attempt for the same logical request.
//   5. provider.capabilities() returns idempotency: false.
//   6. Subprocess that times out → status 'indeterminate' (separate from
//      'error'); caller can distinguish.
//
// Spec §5.15 wiring assertions:
//   - transport_attempt counter is observability only (it does NOT change
//     the logical_request_key).
//   - For idempotency:false providers, timeout|connection_reset|unknown_status
//     classify indeterminate — they are NOT transport-retried (pessimistic).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalCliProvider } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, 'fixtures');
const FLAKY_EXIT_BIN = ['node', resolve(fixturesDir, 'flaky-exit-bin.mjs')];
const BAD_INPUT_BIN = ['node', resolve(fixturesDir, 'bad-input-bin.mjs')];
const SLEEP_BIN = ['node', resolve(fixturesDir, 'sleep-bin.mjs')];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'willbuy-llm-adapter-retry-'));
});

afterEach(() => {
  if (workDir && existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe('LocalCliProvider — transport retry acceptance #1: transient → eventual ok', () => {
  it('exits 137 on calls 1–2, succeeds on call 3 → status="ok", transportAttempts=3', async () => {
    const counterPath = join(workDir, 'counter.txt');
    const recorderPath = join(workDir, 'recorder.jsonl');

    const provider = new LocalCliProvider({
      argv: FLAKY_EXIT_BIN,
      env: {
        WILLBUY_TEST_COUNTER: counterPath,
        WILLBUY_TEST_RECORDER: recorderPath,
        WILLBUY_TEST_EXIT_CODES: '137,137,0',
      },
      // Zero-out backoff for fast tests; the production default is the
      // jittered 0.5 s / 2 s / 8 s schedule from spec §5.15.
      backoffMs: [0, 0, 0],
    });

    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-acc-1',
      maxOutputTokens: 800,
    });

    expect(result.status).toBe('ok');
    expect(result.transportAttempts).toBe(3);
    expect(result.raw).toBe('OK_AFTER_3_ATTEMPTS');

    // Three subprocess invocations actually happened — assert via the
    // recorder rather than just trusting the counter the adapter saw.
    const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });
});

describe('LocalCliProvider — transport retry acceptance #2: transient → exhausted', () => {
  it('exits 137 on all 3 calls → status="error", transportAttempts=3', async () => {
    const counterPath = join(workDir, 'counter.txt');
    const recorderPath = join(workDir, 'recorder.jsonl');

    const provider = new LocalCliProvider({
      argv: FLAKY_EXIT_BIN,
      env: {
        WILLBUY_TEST_COUNTER: counterPath,
        WILLBUY_TEST_RECORDER: recorderPath,
        WILLBUY_TEST_EXIT_CODES: '137,137,137',
      },
      backoffMs: [0, 0, 0],
    });

    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-acc-2',
      maxOutputTokens: 800,
    });

    expect(result.status).toBe('error');
    expect(result.transportAttempts).toBe(3);
    expect(result.raw).toBe('');

    const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
    // Cap is 3 transport attempts, no 4th call.
    expect(lines).toHaveLength(3);
  });
});

describe('LocalCliProvider — transport retry acceptance #3: non-transient (exit 1 + stderr)', () => {
  it('exits 1 with non-empty stderr "bad json" → status="error" immediately, transportAttempts=1', async () => {
    const counterPath = join(workDir, 'counter.txt');
    const recorderPath = join(workDir, 'recorder.jsonl');

    const provider = new LocalCliProvider({
      argv: BAD_INPUT_BIN,
      env: {
        WILLBUY_TEST_COUNTER: counterPath,
        WILLBUY_TEST_RECORDER: recorderPath,
      },
      backoffMs: [0, 0, 0],
    });

    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-acc-3',
      maxOutputTokens: 800,
    });

    expect(result.status).toBe('error');
    expect(result.transportAttempts).toBe(1);
    expect(result.raw).toBe('');

    // Exactly one subprocess invocation — no retry on non_transient.
    const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});

describe('LocalCliProvider — transport retry acceptance #4: same logicalRequestKey across attempts', () => {
  it('forwards the SAME logicalRequestKey as WILLBUY_REQ_KEY on every transport attempt', async () => {
    const counterPath = join(workDir, 'counter.txt');
    const recorderPath = join(workDir, 'recorder.jsonl');

    const provider = new LocalCliProvider({
      argv: FLAKY_EXIT_BIN,
      env: {
        WILLBUY_TEST_COUNTER: counterPath,
        WILLBUY_TEST_RECORDER: recorderPath,
        WILLBUY_TEST_EXIT_CODES: '137,137,0',
      },
      backoffMs: [0, 0, 0],
    });

    const SHARED_KEY = 'lk-shared-across-3-attempts';
    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: SHARED_KEY,
      maxOutputTokens: 800,
    });

    expect(result.status).toBe('ok');
    expect(result.transportAttempts).toBe(3);

    // Spec §5.15: ALL transport retries for the same logical request carry
    // the SAME Idempotency-Key. The local-cli surface is WILLBUY_REQ_KEY
    // on the subprocess env; same key on every invocation, no exception.
    const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const recorded = JSON.parse(line);
      expect(recorded.req_key).toBe(SHARED_KEY);
    }

    // Spec §2 #15: transport_attempt counter is observability only — the
    // logical_request_key MUST NOT include it (otherwise provider-side
    // idempotency dedupe would break). Distinct PIDs prove three real
    // subprocesses; identical req_key proves the logical key is stable.
    const pids = lines.map((line) => JSON.parse(line).pid);
    const uniquePids = new Set(pids);
    expect(uniquePids.size).toBe(3);
  });
});

describe('LocalCliProvider — transport retry acceptance #5: capability flag', () => {
  it('reports idempotency: false (local CLI does not honor Idempotency-Key)', () => {
    const provider = new LocalCliProvider();
    expect(provider.capabilities().idempotency).toBe(false);
  });
});

describe('LocalCliProvider — transport retry acceptance #6: timeout → indeterminate', () => {
  it('subprocess that times out → status="indeterminate" (separate from "error"); transportAttempts=1', async () => {
    const provider = new LocalCliProvider({
      argv: SLEEP_BIN,
      timeoutMs: 250,
      // For an idempotency:false provider, spec §5.15 says
      // timeout|connection_reset|unknown_status MUST NOT be transport-retried;
      // they are pessimistically classified indeterminate and resolved by
      // the daily reconciliation job. Backoff config is therefore moot
      // here, but pass [0,0,0] for fast tests anyway.
      backoffMs: [0, 0, 0],
    });

    const start = Date.now();
    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-acc-6',
      maxOutputTokens: 800,
    });
    const elapsed = Date.now() - start;

    // Distinguishable from 'error' — the caller can branch on this.
    expect(result.status).toBe('indeterminate');
    expect(result.raw).toBe('');
    // No transport retry on timeout for an idempotency:false provider.
    expect(result.transportAttempts).toBe(1);
    // Killed promptly; not waiting on EOF or doing a second 250 ms timeout.
    expect(elapsed).toBeLessThan(2_000);
  });
});
