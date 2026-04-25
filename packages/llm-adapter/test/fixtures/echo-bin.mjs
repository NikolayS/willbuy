#!/usr/bin/env node
// Test fixture: reads stdin, echoes it to stdout. Used by acceptance #1
// to assert LocalCliProvider.chat() pipes (staticPrefix + '\n' + dynamicTail)
// via stdin to the configured binary.

import { stdin, stdout, exit } from 'node:process';

const chunks = [];
stdin.on('data', (c) => chunks.push(c));
stdin.on('end', () => {
  stdout.write(Buffer.concat(chunks));
  exit(0);
});
stdin.on('error', () => exit(2));
