// Spec §2 #14, §2 #15, §5.15 — visitor-worker package entrypoint.
//
// `runVisit(opts)` orchestrates: build prompt → LLMProvider.chat → validate
// against VisitorOutput zod → on validation failure, build a fresh-context
// repair prompt (new logical_request_key by incrementing repair_generation,
// prior bad output passed back as user-role content only — NEVER as an
// assistant turn) and retry up to 2 times.
//
// Heavy lifting lives in ./visitor.js so the package barrel stays stable.

export { runVisit } from './visitor.js';
export type {
  VisitResult,
  RunVisitOptions,
  VisitFailureReason,
  VisitStatus,
} from './visitor.js';
