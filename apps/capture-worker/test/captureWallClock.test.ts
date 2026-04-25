import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureUrl } from '../src/capture.js';
import { startFixtureServer, type FixtureServer } from './server/fixtureServer.js';

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('captureUrl wall-clock ceiling (spec §2 #6)', () => {
  it('aborts with breach_reason="wall_clock" when networkidle never fires', async () => {
    const result = await captureUrl(server.url('/hangs.html'), { wallClockMs: 4_000 });

    expect(result.status).toBe('error');
    expect(result.breach_reason).toBe('wall_clock');
  });
});
