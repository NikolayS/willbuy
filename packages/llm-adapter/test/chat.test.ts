import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalCliProvider } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, 'fixtures');
const ECHO_BIN = ['node', resolve(fixturesDir, 'echo-bin.mjs')];
const RECORD_BIN = ['node', resolve(fixturesDir, 'record-bin.mjs')];
const EXIT_NONZERO_BIN = ['node', resolve(fixturesDir, 'exit-nonzero-bin.mjs')];
const SLEEP_BIN = ['node', resolve(fixturesDir, 'sleep-bin.mjs')];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'willbuy-llm-adapter-'));
});

afterEach(() => {
  if (workDir && existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe('LocalCliProvider — chat() acceptance #1: subprocess invocation', () => {
  it('pipes (staticPrefix + "\\n" + dynamicTail) on stdin to the configured binary, returns stdout as raw', async () => {
    const provider = new LocalCliProvider({
      argv: ECHO_BIN,
    });

    const result = await provider.chat({
      staticPrefix: 'STATIC_PREFIX',
      dynamicTail: 'DYNAMIC_TAIL',
      logicalRequestKey: 'lk-acc-1',
      maxOutputTokens: 800,
    });

    expect(result.status).toBe('ok');
    expect(result.transportAttempts).toBe(1);
    expect(result.raw).toBe('STATIC_PREFIX\nDYNAMIC_TAIL');
  });
});

describe('LocalCliProvider — chat() acceptance #2: fresh process per call', () => {
  it('two consecutive chat() calls spawn two distinct OS processes (no PID reuse, no shared state)', async () => {
    const counterPath = join(workDir, 'counter.txt');
    const recorderPath = join(workDir, 'recorder.jsonl');

    const provider = new LocalCliProvider({
      argv: RECORD_BIN,
      env: {
        WILLBUY_TEST_COUNTER: counterPath,
        WILLBUY_TEST_RECORDER: recorderPath,
      },
    });

    const r1 = await provider.chat({
      staticPrefix: 'P1',
      dynamicTail: 'T1',
      logicalRequestKey: 'lk-call-1',
      maxOutputTokens: 800,
    });
    const r2 = await provider.chat({
      staticPrefix: 'P2',
      dynamicTail: 'T2',
      logicalRequestKey: 'lk-call-2',
      maxOutputTokens: 800,
    });

    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');

    const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    const second = JSON.parse(lines[1]!);

    // Acceptance #2: two distinct processes — counter increments AND PIDs
    // differ. counter is the authoritative "this was a fresh execution"
    // signal because it's written from inside the child, persisted on disk.
    expect(first.counter).toBe(1);
    expect(second.counter).toBe(2);
    expect(first.pid).not.toBe(second.pid);
  });
});

describe('LocalCliProvider — chat() acceptance #3: logical_request_key passthrough', () => {
  it('passes logicalRequestKey through to the subprocess as WILLBUY_REQ_KEY env var', async () => {
    const recorderPath = join(workDir, 'recorder.jsonl');
    const counterPath = join(workDir, 'counter.txt');

    const provider = new LocalCliProvider({
      argv: RECORD_BIN,
      env: {
        WILLBUY_TEST_COUNTER: counterPath,
        WILLBUY_TEST_RECORDER: recorderPath,
      },
    });

    // Spec §5.15: schema-repair retry increments repair_generation, yielding
    // a NEW logical_request_key. Two calls with distinct keys must each see
    // their own key in the subprocess env (no leakage, no reuse).
    await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-original',
      maxOutputTokens: 800,
    });
    await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-after-schema-repair',
      maxOutputTokens: 800,
    });

    const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
    const first = JSON.parse(lines[0]!);
    const second = JSON.parse(lines[1]!);
    expect(first.req_key).toBe('lk-original');
    expect(second.req_key).toBe('lk-after-schema-repair');
  });
});

describe('LocalCliProvider — chat() acceptance #4: error paths', () => {
  it('subprocess exit non-zero → status="error", raw is empty', async () => {
    const provider = new LocalCliProvider({
      argv: EXIT_NONZERO_BIN,
    });

    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-exit-nonzero',
      maxOutputTokens: 800,
    });

    expect(result.status).toBe('error');
    expect(result.raw).toBe('');
  });

  it('subprocess timeout → status="error" and the process is killed', async () => {
    const provider = new LocalCliProvider({
      argv: SLEEP_BIN,
      timeoutMs: 250,
    });

    const start = Date.now();
    const result = await provider.chat({
      staticPrefix: 'P',
      dynamicTail: 'T',
      logicalRequestKey: 'lk-timeout',
      maxOutputTokens: 800,
    });
    const elapsed = Date.now() - start;

    expect(result.status).toBe('error');
    expect(result.raw).toBe('');
    // Should resolve well before vitest's per-test timeout, proving the
    // adapter actually killed the child rather than waiting on EOF.
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe('LocalCliProvider — env-var configuration', () => {
  it('falls back to WILLBUY_LLM_BIN env var when no argv passed', async () => {
    const recorderPath = join(workDir, 'recorder.jsonl');
    const counterPath = join(workDir, 'counter.txt');

    // The env-var-resolved binary is the record fixture; argv stays undefined.
    const prevBin = process.env.WILLBUY_LLM_BIN;
    process.env.WILLBUY_LLM_BIN = `node ${RECORD_BIN[1]}`;
    try {
      const provider = new LocalCliProvider({
        env: {
          WILLBUY_TEST_COUNTER: counterPath,
          WILLBUY_TEST_RECORDER: recorderPath,
        },
      });
      const result = await provider.chat({
        staticPrefix: 'envP',
        dynamicTail: 'envT',
        logicalRequestKey: 'lk-env',
        maxOutputTokens: 800,
      });
      expect(result.status).toBe('ok');
      const lines = readFileSync(recorderPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const recorded = JSON.parse(lines[0]!);
      expect(recorded.req_key).toBe('lk-env');
    } finally {
      if (prevBin === undefined) {
        delete process.env.WILLBUY_LLM_BIN;
      } else {
        process.env.WILLBUY_LLM_BIN = prevBin;
      }
    }
  });
});
