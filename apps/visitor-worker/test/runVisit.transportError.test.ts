import { describe, expect, it } from 'vitest';

import { runVisit } from '../src/index.js';
import { MockProvider } from './helpers/mockProvider.js';
import {
  SAMPLE_BACKSTORY,
  SAMPLE_PAGE_SNAPSHOT,
} from './helpers/fixtures.js';

// Issue #9 acceptance #4 (spec §5.15): when the adapter returns
// status='error', the orchestrator does NOT schema-repair — that path
// is reserved for cases where the model actually ran and produced
// (mis-shaped) output. Spec §5.15: transport retries are inside the
// adapter; the orchestrator's job on transport failure is to surface
// failure_reason='transport' and stop.

describe('runVisit — acceptance #4: chat() returns status="error"', () => {
  it('returns failed with failure_reason="transport" and attempts=1; NO schema repair attempted', async () => {
    const provider = new MockProvider({
      responses: [
        // Spec §5.15 / §4.1 LocalCliProvider: empty raw + status='error'
        // is the canonical transport-error shape returned by the adapter.
        { raw: '', transportAttempts: 1, status: 'error' },
        // No further responses — if the orchestrator schema-repairs here,
        // MockProvider would throw "exhausted", which would surface as
        // a different failure mode and make the test red for the wrong
        // reason. With this single-response script, an extra chat()
        // call is structurally observable.
      ],
    });

    const result = await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: 'visit-acc-4',
    });

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('transport');
    expect(result.attempts).toBe(1);
    expect(result.parsed).toBeUndefined();

    // Exactly one chat() call — the orchestrator did not schema-repair
    // through the transport-error branch.
    expect(provider.calls).toHaveLength(1);
  });
});
