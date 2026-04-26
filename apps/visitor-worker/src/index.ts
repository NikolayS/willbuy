// Spec §2 #14, §2 #15, §5.15 — visitor-worker package entrypoint.
//
// `runVisit(opts)` orchestrates: build prompt → LLMProvider.chat → validate
// against VisitorOutput zod → on validation failure, build a fresh-context
// repair prompt (new logical_request_key by incrementing repair_generation,
// prior bad output passed back as user-role content only — NEVER as an
// assistant turn) and retry up to 2 times.
//
// `pollVisitorOnce` / `runVisitorPollingLoop` poll the visits table for rows
// with study.status='visiting' and parsed IS NULL, run the LLM visitor, and
// write results back. When all visits for a study are processed the study
// advances to 'aggregating'.
//
// Heavy lifting lives in ./visitor.js and ./poller.js so the package barrel
// stays stable.

export { runVisit, computeLogicalRequestKey } from './visitor.js';
export type {
  VisitResult,
  RunVisitOptions,
  VisitFailureReason,
  VisitStatus,
  LeaseReleaseContext,
} from './visitor.js';

export { pollVisitorOnce, runVisitorPollingLoop } from './poller.js';
export type { PollVisitorOpts, PollVisitorResult, ObjectStorage } from './poller.js';
