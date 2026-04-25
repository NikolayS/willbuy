import { describe, expect, it } from 'vitest';

import { runVisit } from '../src/index.js';
import { computeLogicalRequestKey } from '../src/visitor.js';
import { MockProvider } from './helpers/mockProvider.js';
import {
  SAMPLE_BACKSTORY,
  SAMPLE_PAGE_SNAPSHOT,
} from './helpers/fixtures.js';

// Issue #9 acceptance #3 (spec §2 #14): three invalid responses in a row
// → status='failed', failure_reason='schema', attempts=3. Spec §2 #14
// caps schema-repair retries at 2 per logical request; with the initial
// attempt that's exactly 3 chat() calls.

describe('runVisit — acceptance #3: invalid 3 times → failed/schema', () => {
  it('returns failed with failure_reason="schema" and attempts=3 after 3 invalid responses', async () => {
    const bad1 = '{"first_impression": "bad-1"}';
    const bad2 = '{"first_impression": "bad-2"}';
    const bad3 = '{"first_impression": "bad-3"}';

    const provider = new MockProvider({
      responses: [
        { raw: bad1, transportAttempts: 1, status: 'ok' },
        { raw: bad2, transportAttempts: 1, status: 'ok' },
        { raw: bad3, transportAttempts: 1, status: 'ok' },
      ],
    });

    const result = await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: 'visit-acc-3',
    });

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('schema');
    expect(result.attempts).toBe(3);
    expect(result.parsed).toBeUndefined();
    // Last raw payload is preserved on failed/schema for observability.
    expect(result.raw).toBe(bad3);

    expect(provider.calls).toHaveLength(3);

    // Spec §5.15: each schema-repair generation gets a NEW logical key.
    // Three calls → three distinct keys, each matching the canonical
    // sha256(visit_id || provider || model || 'visit' || generation) form
    // — model component added per issue #23 / B1.
    const keys = provider.calls.map((c) => c.logicalRequestKey);
    expect(new Set(keys).size).toBe(3);

    expect(keys[0]).toBe(
      computeLogicalRequestKey(
        'visit-acc-3',
        provider.name(),
        provider.model(),
        0,
      ),
    );
    expect(keys[1]).toBe(
      computeLogicalRequestKey(
        'visit-acc-3',
        provider.name(),
        provider.model(),
        1,
      ),
    );
    expect(keys[2]).toBe(
      computeLogicalRequestKey(
        'visit-acc-3',
        provider.name(),
        provider.model(),
        2,
      ),
    );
  });
});
