// Spec §2 #14, §2 #15, §5.15 — visitor orchestrator.
//
// At this step (acceptance #2): up to 1 schema-repair retry. On
// validation failure we build a FRESH-CONTEXT repair call — prior bad
// raw output passed back as user-role content only, NEVER as an
// assistant turn — and retry once. The 2-repair upper bound and the
// transport-error branch arrive in subsequent acceptance pairs.

import { createHash } from 'node:crypto';

import type { LLMProvider } from '@willbuy/llm-adapter';
import { VisitorOutput } from '@willbuy/shared';
import type { BackstoryT, VisitorOutputT } from '@willbuy/shared';

import {
  buildDynamicTail,
  buildRepairTail,
  buildStaticPrefix,
} from './prompt.js';

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

// Spec §2 #14: up to 2 schema-repair retries. With the initial attempt
// that's 3 chat() calls maximum per visit (repair_generation = 0, 1, 2).
const MAX_REPAIR_GENERATION = 2;

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

function tryParse(
  raw: string,
):
  | { ok: true; parsed: VisitorOutputT }
  | { ok: false; error: string } {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = VisitorOutput.safeParse(candidate);
  if (result.success) {
    return { ok: true, parsed: result.data };
  }
  // Compact zod issue summary — keeps the repair prompt small. Each issue
  // becomes "<path>: <message>" so the model can target the failing field.
  const summary = result.error.issues
    .map((iss) => `${iss.path.join('.') || '<root>'}: ${iss.message}`)
    .join('; ');
  return { ok: false, error: summary };
}

export async function runVisit(opts: RunVisitOptions): Promise<VisitResult> {
  const staticPrefix = buildStaticPrefix();
  const providerName = opts.provider.name();

  let attempts = 0;
  let lastRaw = '';
  let lastValidationError = '';

  for (
    let repairGeneration = 0;
    repairGeneration <= MAX_REPAIR_GENERATION;
    repairGeneration += 1
  ) {
    const dynamicTail =
      repairGeneration === 0
        ? buildDynamicTail(opts.backstory, opts.pageSnapshot)
        : buildRepairTail(
            opts.backstory,
            opts.pageSnapshot,
            lastRaw,
            lastValidationError,
          );

    const logicalRequestKey = computeLogicalRequestKey(
      opts.visitId,
      providerName,
      repairGeneration,
    );

    attempts += 1;
    const chatResult = await opts.provider.chat({
      staticPrefix,
      dynamicTail,
      logicalRequestKey,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    if (chatResult.status === 'error') {
      // Spec §5.15: transport retries are the adapter's job. The orchestrator
      // does NOT schema-repair on a transport failure — the model never ran,
      // so there is no prior raw output to feed back as repair input.
      return {
        status: 'failed',
        attempts,
        failure_reason: 'transport',
        raw: chatResult.raw,
      };
    }

    // Both 'ok' and 'indeterminate' carry a raw payload we can try to parse;
    // 'indeterminate' is treated as best-effort here because spec §5.15's
    // pessimistic-debit + reconciliation flow is owned by the adapter and
    // the API server's spend ledger, not by this orchestrator.
    const parsed = tryParse(chatResult.raw);
    if (parsed.ok) {
      return {
        status: 'ok',
        parsed: parsed.parsed,
        raw: chatResult.raw,
        attempts,
      };
    }

    lastRaw = chatResult.raw;
    lastValidationError = parsed.error;
  }

  return {
    status: 'failed',
    attempts,
    failure_reason: 'schema',
    raw: lastRaw,
  };
}
