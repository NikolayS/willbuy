#!/usr/bin/env node
// Test fixture: drains stdin then exits with code 7. Used by acceptance #4
// to assert non-zero exit yields status='error' with empty raw output.

import { stdin, exit } from 'node:process';

stdin.on('data', () => {});
stdin.on('end', () => exit(7));
stdin.on('error', () => exit(2));
