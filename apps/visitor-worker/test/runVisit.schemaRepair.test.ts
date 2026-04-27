import { describe, expect, it } from 'vitest';

import { runVisit } from '../src/index.js';
import {
  PRIOR_BAD_OUTPUT_END_MARKER,
  PRIOR_BAD_OUTPUT_MARKER,
} from '../src/prompt.js';
import { MockProvider } from './helpers/mockProvider.js';
import {
  SAMPLE_BACKSTORY,
  SAMPLE_PAGE_SNAPSHOT,
  VALID_VISITOR_OUTPUT,
  validVisitorJsonString,
} from './helpers/fixtures.js';

// Issue #9 acceptance #2 (spec §2 #14, §5.15): mocked provider returns
// invalid JSON on the first call, valid on the second → status='ok',
// attempts=2. The second chat() invocation MUST contain the prior bad
// output as user-role content (no assistant-role turn anywhere) and
// MUST carry a NEW logical_request_key (repair_generation incremented).

describe('runVisit — acceptance #2: invalid then valid JSON', () => {
  it('schema-repairs once, returns ok with attempts=2; second call carries prior bad output as user content with a new logical key', async () => {
    const priorBad =
      '{"first_impression": "missing required fields, only this one present"}';

    const provider = new MockProvider({
      responses: [
        // Call #1: structurally JSON, semantically wrong → triggers repair.
        { raw: priorBad, transportAttempts: 1, status: 'ok' },
        // Call #2: valid VisitorOutput.
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
      visitId: 'visit-acc-2',
    });

    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(result.failure_reason).toBeUndefined();
    expect(result.parsed).toEqual(VALID_VISITOR_OUTPUT);

    expect(provider.calls).toHaveLength(2);

    const firstCall = provider.calls[0]!;
    const secondCall = provider.calls[1]!;

    // Spec §2 #14 + §5.15: the prior bad output is presented to the model
    // as USER content (the dynamicTail is the single user-role payload at
    // the adapter's chat() boundary; the LLMChatOptions surface has no
    // assistant-role channel by design — fresh-context guarantee).
    expect(secondCall.dynamicTail).toContain(priorBad);
    expect(secondCall.dynamicTail).toContain(PRIOR_BAD_OUTPUT_MARKER);
    expect(secondCall.dynamicTail).toContain(PRIOR_BAD_OUTPUT_END_MARKER);

    // Defense-in-depth grep: the repair tail must not casually use the
    // word "assistant" — that would lie about the role boundary even
    // though the API surface enforces it.
    expect(secondCall.dynamicTail.toLowerCase()).not.toContain('assistant');

    // Static prefix is byte-identical across both calls (cacheable prefix
    // invariant per spec §1).
    expect(secondCall.staticPrefix).toBe(firstCall.staticPrefix);

    // Logical request key MUST differ between repair generations
    // (spec §5.15: schema-repair = NEW logical key).
    expect(secondCall.logicalRequestKey).not.toBe(firstCall.logicalRequestKey);
  });
});

// ── PRIOR_BAD_OUTPUT_MARKER spec-pin (spec §2 #14) ───────────────────────────
//
// The exact sentinel strings are the cross-cutting contract between:
//   - prompt.ts  (embeds them in the repair tail)
//   - visitor.ts (looks for them to detect the repair section)
//   - tests      (grep on them to assert user-role placement)
// Changing either value silently breaks the repair-tail assembly without
// any other test failing.

describe('PRIOR_BAD_OUTPUT_MARKER spec-pin (spec §2 #14)', () => {
  it('PRIOR_BAD_OUTPUT_MARKER is "PRIOR_BAD_OUTPUT_BEGIN"', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER).toBe('PRIOR_BAD_OUTPUT_BEGIN');
  });

  it('PRIOR_BAD_OUTPUT_END_MARKER is "PRIOR_BAD_OUTPUT_END"', () => {
    expect(PRIOR_BAD_OUTPUT_END_MARKER).toBe('PRIOR_BAD_OUTPUT_END');
  });

  it('the two markers are distinct', () => {
    expect(PRIOR_BAD_OUTPUT_MARKER).not.toBe(PRIOR_BAD_OUTPUT_END_MARKER);
  });
});
