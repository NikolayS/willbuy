#!/usr/bin/env node
// Test fixture for issue #27 (transport-retry): consults a counter file
// (WILLBUY_TEST_COUNTER) and a comma-separated list of exit codes
// (WILLBUY_TEST_EXIT_CODES, e.g. "137,137,0"). On invocation N (1-based)
// it exits with the Nth code in the list. Also records each invocation's
// env (PID, counter, WILLBUY_REQ_KEY, WILLBUY_LLM_MODEL) to
// WILLBUY_TEST_RECORDER so the test can assert the same logical_request_key
// is forwarded on every transport attempt.
//
// Used by:
//  - acceptance #1 (137,137,0 → adapter retries up to 3 times, succeeds)
//  - acceptance #2 (137,137,137 → adapter exhausts 3 attempts, errors)
//  - acceptance #4 (record env on every attempt; same key across attempts)

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout, env, pid, exit } from 'node:process';

const counterPath = env.WILLBUY_TEST_COUNTER;
const recorderPath = env.WILLBUY_TEST_RECORDER;
const codesEnv = env.WILLBUY_TEST_EXIT_CODES ?? '0';
const codes = codesEnv
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

let counter = 0;
if (counterPath) {
  try {
    counter = Number(readFileSync(counterPath, 'utf8') || '0') + 1;
  } catch {
    counter = 1;
  }
  writeFileSync(counterPath, String(counter));
}

const idx = Math.min(counter - 1, codes.length - 1);
const exitCode = codes[idx] ?? 0;

const chunks = [];
stdin.on('data', (c) => chunks.push(c));
stdin.on('end', () => {
  const line = JSON.stringify({
    pid,
    counter,
    exit_code: exitCode,
    req_key: env.WILLBUY_REQ_KEY ?? null,
    model: env.WILLBUY_LLM_MODEL ?? null,
  });
  if (recorderPath) {
    appendFileSync(recorderPath, line + '\n');
  }
  // On a "successful" attempt, write a recognizable payload to stdout so
  // the test can assert raw is preserved across retried attempts. On a
  // "failing" attempt, write nothing — the adapter's error path expects
  // empty raw on non-zero exit anyway.
  if (exitCode === 0) {
    stdout.write(`OK_AFTER_${counter}_ATTEMPTS`);
  }
  exit(exitCode);
});
stdin.on('error', () => exit(2));
