// Spec §2 #14, §2 #15, §5.15 — visitor orchestrator.
//
// runVisit() builds the visitor prompt, calls LLMProvider.chat once,
// validates against VisitorOutput zod, and on validation failure
// constructs a fresh-context repair call (new logical_request_key per
// `sha256(visit_id || provider || model || 'visit' || repair_generation)`,
// prior bad output as user-role content only — NEVER as an assistant turn)
// up to MAX_REPAIR_GENERATION (= 2) times.
// Adapter `status: 'error'` short-circuits to failure_reason='transport'
// without entering the schema-repair loop (transport retries belong to
// the adapter, per §5.15).
//
// Terminal-commit invariant (spec §5.11): when RunVisitOptions.leaseRelease
// is provided, releaseLease() is called in a finally block so the
// per-backstory lease is released immediately on BOTH the ok and failed
// paths — not held until the 120s lease_until expiry. This is required
// for paired-A/B throughput: visit B cannot start until visit A's lease
// is released.

import { createHash } from 'node:crypto';

import type { LLMProvider } from '@willbuy/llm-adapter';
import { VisitorOutput } from '@willbuy/shared';
import type { BackstoryT, VisitorOutputT } from '@willbuy/shared';
import { releaseLease } from '@willbuy/api/leases/backstory-lease';
import type { Pool } from '@willbuy/api/leases/backstory-lease';

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

// Spec §5.11: caller passes this when a per-backstory lease was acquired
// before the visit. runVisit() releases it in a finally block so the lease
// is freed on BOTH ok and failed terminal paths.
export interface LeaseReleaseContext {
  pool: Pool;
  backstory_id: bigint | number;
  owner_visit_id: bigint | number;
}

export interface RunVisitOptions {
  provider: LLMProvider;
  backstory: BackstoryT;
  pageSnapshot: string;
  visitId: string;
  // Optional: if provided, the per-backstory lease is released in the
  // terminal-commit finally block (spec §5.11). Without this option,
  // the lease is left to expire naturally (backward-compatible).
  leaseRelease?: LeaseReleaseContext;
}

// Spec §2 #15 — the visitor call is capped at 800 output tokens.
const MAX_OUTPUT_TOKENS = 800;

// Spec §2 #14: up to 2 schema-repair retries. With the initial attempt
// that's 3 chat() calls maximum per visit (repair_generation = 0, 1, 2).
const MAX_REPAIR_GENERATION = 2;

// Spec §5.15 line 253 + §5.1 step 7 line 131 + §2 #15:
//   logical_request_key = sha256(
//     visit_id || provider || model || request_kind || repair_generation
//   )
// Repair_generation increments on each schema-repair retry, yielding a
// distinct logical key per generation; transport retries inside the
// adapter share the key. The `model` component (added per issue #23 / B1)
// guards the §5.15 collision case where a model bump on the same provider
// would otherwise reuse a provider-side Idempotency-Key.
export function computeLogicalRequestKey(
  visitId: string,
  providerName: string,
  modelName: string,
  repairGeneration: number,
): string {
  const h = createHash('sha256');
  h.update(visitId);
  h.update('|');
  h.update(providerName);
  h.update('|');
  h.update(modelName);
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
  // Spec §5.15: pin the model identity once per visit so all repair
  // generations of one visit hash against the same model. A mid-visit
  // env-var bump would otherwise produce non-comparable keys across
  // generation 0 / 1 / 2 of the SAME logical visit.
  const modelName = opts.provider.model();

  let attempts = 0;
  let lastRaw = '';
  let lastValidationError = '';

  // Spec §5.11 terminal-commit invariant: release the per-backstory lease
  // in a finally block so it fires on BOTH the ok path and ALL failure paths
  // (transport + schema). This prevents a failed visit from holding the lease
  // for the full 120s TTL and blocking the paired-A/B counterpart visit.
  try {
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
        modelName,
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
  } finally {
    // Spec §5.11: release the per-backstory lease immediately on terminal
    // commit. releaseLease is a no-op if leaseRelease is not provided or if
    // the caller is no longer the holder (idempotent DELETE).
    if (opts.leaseRelease) {
      await releaseLease(opts.leaseRelease.pool, {
        backstory_id: opts.leaseRelease.backstory_id,
        owner_visit_id: opts.leaseRelease.owner_visit_id,
      });
    }
  }
}

// Test seam — not part of the public API surface.
export const __test__ = { MAX_OUTPUT_TOKENS, MAX_REPAIR_GENERATION };
