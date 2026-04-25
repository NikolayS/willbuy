#!/usr/bin/env node
// Test fixture: drains stdin, then sleeps far longer than any test would
// reasonably wait. Used by acceptance #4 to assert the adapter timeout
// kills the subprocess and yields status='error'.

import { stdin } from 'node:process';

stdin.on('data', () => {});
stdin.on('end', () => {
  // 60 s — well beyond the 250 ms timeout the timeout test passes in.
  setTimeout(() => {}, 60_000);
});
