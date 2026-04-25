import { describe, it, expect } from 'vitest';
import { captureUrl } from '../src/capture.js';

/**
 * Live-network smoke test, gated by SMOKE_URL. Skipped by default so
 * CI doesn't reach out to the public internet on every PR.
 *
 *   SMOKE_URL=https://example.com bun --cwd apps/capture-worker run smoke
 *
 * Inside the hardened container the equivalent invocation (docker line
 * pasted in the PR description) runs the same vitest target.
 */
const URL_ = process.env.SMOKE_URL;

describe.skipIf(!URL_)('captureUrl smoke (SMOKE_URL)', () => {
  it(`returns ok for ${URL_ ?? '<unset>'}`, async () => {
    const result = await captureUrl(URL_!);
    // Print to stdout so CI logs / smoke evidence captures the shape.
    console.log(
      JSON.stringify(
        {
          status: result.status,
          url: result.url,
          host_count: result.host_count,
          breach_reason: result.breach_reason,
          blocked_reason: result.blocked_reason,
          a11y_root_role: result.a11y_tree[0]?.role ?? null,
          a11y_root_name: result.a11y_tree[0]?.name ?? null,
        },
        null,
        2,
      ),
    );
    expect(['ok', 'blocked']).toContain(result.status);
  }, 90_000);
});
