#!/usr/bin/env node
// Test fixture: records its own PID + a per-invocation counter (read from
// a counter file passed via WILLBUY_TEST_COUNTER) and writes a JSON line
// to a recorder file passed via WILLBUY_TEST_RECORDER. Stdout returns the
// JSON line so the caller can also parse it. Acceptance #2 (fresh process
// per call) uses this to assert two consecutive calls produce two distinct
// PIDs and two separate counter increments.
//
// Also echoes WILLBUY_REQ_KEY and WILLBUY_LLM_MODEL into the recorded line
// so acceptance #3 / #3b (logical_request_key + model reach the subprocess)
// can assert pass-through.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout, env, pid, exit } from 'node:process';

const counterPath = env.WILLBUY_TEST_COUNTER;
const recorderPath = env.WILLBUY_TEST_RECORDER;

let counter = 0;
if (counterPath) {
  try {
    counter = Number(readFileSync(counterPath, 'utf8') || '0') + 1;
  } catch {
    counter = 1;
  }
  writeFileSync(counterPath, String(counter));
}

const chunks = [];
stdin.on('data', (c) => chunks.push(c));
stdin.on('end', () => {
  const stdinStr = Buffer.concat(chunks).toString('utf8');
  const line = JSON.stringify({
    pid,
    counter,
    req_key: env.WILLBUY_REQ_KEY ?? null,
    model: env.WILLBUY_LLM_MODEL ?? null,
    stdin_len: stdinStr.length,
    stdin_sha_prefix: stdinStr.slice(0, 64),
  });
  if (recorderPath) {
    appendFileSync(recorderPath, line + '\n');
  }
  stdout.write(line);
  exit(0);
});
stdin.on('error', () => exit(2));
