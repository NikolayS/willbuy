import { describe, expect, it } from 'vitest';

import { runVisit } from '../src/index.js';
import { MockProvider } from './helpers/mockProvider.js';
import {
  SAMPLE_BACKSTORY,
  SAMPLE_PAGE_SNAPSHOT,
  VALID_VISITOR_OUTPUT,
  validVisitorJsonString,
} from './helpers/fixtures.js';

// Issue #9 acceptance #1 (spec §2 #14): mocked provider returns valid JSON
// on the first call → status='ok', attempts=1, parsed equals VALID payload.

describe('runVisit — acceptance #1: valid JSON on first call', () => {
  it('returns status="ok" with attempts=1 and the parsed VisitorOutput', async () => {
    const provider = new MockProvider({
      responses: [
        {
          raw: validVisitorJsonString(),
          transportAttempts: 1,
          status: 'ok',
        },
      ],
    });

    const result = await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: 'visit-acc-1',
    });

    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(result.failure_reason).toBeUndefined();
    expect(result.parsed).toEqual(VALID_VISITOR_OUTPUT);
    expect(result.raw).toBe(validVisitorJsonString());
    // Exactly one upstream chat() call — no schema repair, no transport
    // re-issue from the orchestrator.
    expect(provider.calls).toHaveLength(1);
  });
});
