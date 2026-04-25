// Spec §2 #14, §2 #15, §5.15 — visitor orchestrator.
//
// At this step (acceptance #1): a single chat() call, parse the result
// against VisitorOutput, return ok. Transport-error and schema-repair
// branches arrive in subsequent red→green pairs.

import { createHash } from 'node:crypto';

import type { LLMProvider } from '@willbuy/llm-adapter';
import { VisitorOutput } from '@willbuy/shared';
import type { BackstoryT, VisitorOutputT } from '@willbuy/shared';

import { buildDynamicTail, buildStaticPrefix } from './prompt.js';

export type VisitStatus = 'ok' | 'failed';
export type VisitFailureReason = 'schema' | 'transport' | 'cap';

export interface VisitResult {
  status: VisitStatus;
  parsed?: VisitorOutputT;
  raw?: string;
  attempts: number;
  failure_reason?: VisitFailureReason;
}

export interface RunVisitOptions {
  provider: LLMProvider;
  backstory: BackstoryT;
  pageSnapshot: string;
  visitId: string;
}

// Spec §2 #15 — the visitor call is capped at 800 output tokens.
const MAX_OUTPUT_TOKENS = 800;

// Spec §5.15 + issue #9: logical_request_key for the visit-kind call is
// sha256(visitId || provider.name() || 'visit' || repair_generation).
// Repair_generation increments on each schema-repair retry, yielding a
// distinct logical key per generation; transport retries inside the
// adapter share the key.
export function computeLogicalRequestKey(
  visitId: string,
  providerName: string,
  repairGeneration: number,
): string {
  const h = createHash('sha256');
  h.update(visitId);
  h.update('|');
  h.update(providerName);
  h.update('|');
  h.update('visit');
  h.update('|');
  h.update(String(repairGeneration));
  return h.digest('hex');
}

export async function runVisit(opts: RunVisitOptions): Promise<VisitResult> {
  const staticPrefix = buildStaticPrefix();
  const dynamicTail = buildDynamicTail(opts.backstory, opts.pageSnapshot);
  const logicalRequestKey = computeLogicalRequestKey(
    opts.visitId,
    opts.provider.name(),
    0,
  );

  const chatResult = await opts.provider.chat({
    staticPrefix,
    dynamicTail,
    logicalRequestKey,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const candidate: unknown = JSON.parse(chatResult.raw);
  const parsed = VisitorOutput.parse(candidate);
  return {
    status: 'ok',
    parsed,
    raw: chatResult.raw,
    attempts: 1,
  };
}
