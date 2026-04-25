#!/usr/bin/env node
// Test fixture for issue #27 (transport-retry): exits with code 1 and writes
// a "bad json" diagnostic to stderr. Used by acceptance #3 to assert the
// adapter classifies exit-1-with-stderr as a non-transient error, returns
// immediately, and does NOT transport-retry.
//
// Also records each invocation to WILLBUY_TEST_RECORDER so the test can
// verify exactly one attempt happened.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stderr, env, pid, exit } from 'node:process';

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

stdin.on('data', () => {});
stdin.on('end', () => {
  if (recorderPath) {
    appendFileSync(
      recorderPath,
      JSON.stringify({ pid, counter, kind: 'bad-input' }) + '\n',
    );
  }
  stderr.write('bad json: expected object, got token at line 1 col 1\n');
  exit(1);
});
stdin.on('error', () => exit(2));
