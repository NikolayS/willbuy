// Spec §2 #14, §2 #15, §5.15 — visitor orchestrator. Skeleton only at
// this commit; behavior lands in subsequent red→green pairs.

import type { LLMProvider } from '@willbuy/llm-adapter';
import type { BackstoryT, VisitorOutputT } from '@willbuy/shared';

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

export async function runVisit(_opts: RunVisitOptions): Promise<VisitResult> {
  // Skeleton placeholder — drives the package-skeleton test green.
  // Behavior arrives in the next red→green pair.
  return { status: 'failed', attempts: 0, failure_reason: 'transport' };
}
