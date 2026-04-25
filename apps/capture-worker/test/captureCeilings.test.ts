import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureUrl } from '../src/capture.js';
import { CAPTURE_CEILINGS } from '../src/types.js';
import { startFixtureServer, type FixtureServer } from './server/fixtureServer.js';

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('captureUrl ceiling enforcement — total_bytes, a11y_tree_bytes, dom_nodes (spec §2 #6)', () => {
  it('aborts with breach_reason="total_bytes" when response body exceeds budget', async () => {
    // The /__big-body route returns 30 MB with a content-length header so the
    // response listener tallies it before the body is fully buffered. We set a
    // 1-byte budget so the breach fires on the very first response.
    const result = await captureUrl(server.url('/__big-body?bytes=' + String(30 * 1024 * 1024)), {
      totalBytesBudget: 1,
      wallClockMs: 30_000,
    });

    expect(result.status).toBe('error');
    expect(result.breach_reason).toBe('total_bytes');
  });

  it('aborts with breach_reason="a11y_tree_bytes" when serialized tree exceeds budget', async () => {
    // simple.html produces a multi-node a11y tree; a 1-byte budget makes
    // any non-empty serialization breach the post-extraction check.
    const result = await captureUrl(server.url('/simple.html'), {
      a11yTreeBytesBudget: 1,
      wallClockMs: 30_000,
    });

    expect(result.status).toBe('error');
    expect(result.breach_reason).toBe('a11y_tree_bytes');
  });

  it('aborts with breach_reason="dom_nodes" when DOM node count exceeds budget', async () => {
    // simple.html has several DOM nodes; a 1-node budget triggers the
    // post-extraction CDP count check.
    const result = await captureUrl(server.url('/simple.html'), {
      domNodesBudget: 1,
      wallClockMs: 30_000,
    });

    expect(result.status).toBe('error');
    expect(result.breach_reason).toBe('dom_nodes');
  });

  it('CAPTURE_CEILINGS.TOTAL_BYTES is set to 25 MB per spec §2 #6', () => {
    expect(CAPTURE_CEILINGS.TOTAL_BYTES).toBe(25 * 1024 * 1024);
  });
});
