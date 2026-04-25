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

describe('captureUrl host-count ceiling (spec §2 #5 + §2 #6)', () => {
  it('aborts with breach_reason="host_count" when distinct hosts exceed budget', async () => {
    // Drive the breach via the injectable host extractor so we don't have
    // to actually open 51 TCP connections in-test. A request listener
    // counts unique hosts; the ceiling is enforced from the same code
    // path the production listener uses.
    let i = 0;
    const result = await captureUrl(server.url('/many-hosts.html'), {
      hostCountBudget: 3,
      hostExtractor: () => `synthetic-host-${i++}.example`,
    });

    expect(result.status).toBe('error');
    expect(result.breach_reason).toBe('host_count');
    expect(result.host_count).toBeGreaterThan(3);
  });
});
