# Reviewer A — Codex

## summary

The spec's biggest gap is containment and data minimization: arbitrary-page capture, persistent public artifacts, and multi-provider model routing create a much larger security and compliance surface than the document acknowledges. Several hard guarantees the product depends on - fresh context, paired isolation, exact spend accounting, and resumability - are also not actually enforced by the described implementation.

## missing-risk

- (major) The capture plane is the highest-risk component and the spec does not isolate it strongly enough. A Playwright container visiting arbitrary URLs can still hit internal services via subresources, redirects, WebSockets, service workers, DNS rebinding, or a browser escape; 'one container per capture' plus URL validation is not a real security boundary. v0.1 needs a hardened sandbox/microVM, default-deny egress, no cloud-metadata/VPC reachability, request interception, and strict CPU/memory/time limits.
- (major) Permanent public report URLs combined with stored screenshots, raw a11y dumps, and full LLM transcripts is a data-leak design. `noindex` does not protect sensitive pricing experiments, checkout content, consultant deliverables, or accidentally captured PII/secrets. Reports should be private-by-default, revocable/expiring, and backed by retention/redaction rules for debug artifacts.
- (major) The product captures arbitrary customer pages and then sends page content, custom ICP text, and cluster strings to multiple model and embedding providers by design, but the spec has no data-classification, provider-routing, redaction, or consent story. For CRO consultants and checkout pages, that is a trust/compliance blocker, not a later enhancement.
- (major) Abuse controls are incomplete for a public render service. Basic Cloudflare WAF and per-account spend caps do not stop render bombs, huge DOMs, infinite scroll, large screenshots, asset floods, or high-cardinality URL abuse from exhausting worker CPU, memory, storage, and outbound bandwidth. v0.1 needs per-account/domain concurrency budgets, request/response caps, artifact size caps, navigation ceilings, and circuit breakers.
- (minor) API key handling is underspecified for incident response. One rotatable live key per account without scopes, expiry, last-used metadata, or a fast kill switch creates an unnecessarily large blast radius when a key leaks or an automation script is compromised.
- (minor) The storage and backup plan mentions restore drills but not key management. With screenshots, transcripts, and raw page captures in object storage and backups, the spec should explicitly define encryption at rest, secret rotation, preview/staging/prod separation, and who can access artifacts.

## weak-implementation

- (major) The 'fresh-context' claim is undercut by the retry design. 'Your last response did not match schema, fix it' reuses the same conversation state, so prompt injection or earlier model state persists across retries. If isolation and reproducibility matter, retries must rebuild a brand-new request or repair JSON outside the model conversation.
- (major) Paired A/B isolation is not actually enforced. With concurrent workers, the same backstory can be sent to variant A and variant B at the same time unless there is a per-backstory lock or lease. `UNIQUE(study_id, backstory_id, variant_idx)` only prevents duplicate rows, not simultaneous cross-variant execution.
- (major) Cost and ledger correctness is specified more strongly than the implementation can guarantee. An external LLM call cannot be atomically included in the same transaction as a visit-row write; a crash after provider acceptance but before DB commit creates orphan spend, and retrying the job can double-charge. v0.1 needs idempotency keys per visit attempt, explicit reserve/commit/refund semantics, and provider-billing reconciliation.
- (major) The Postgres `SKIP LOCKED` queue design is too thin for long-running Playwright and LLM jobs. Missing leases/heartbeats, visibility timeouts, attempt records, poison-job handling, and dead-lettering will leave `in_flight` work stranded or duplicated after restarts and network partitions.

## unnecessary-scope

- (minor) v0.1 is carrying too much ops/product surface at once: self-hosted Supabase, preview env per PR, multi-provider fallback, permanent public reports, prepaid credits, and resumable orchestration. The real launch risk is evaluation quality; this scope materially increases incident probability before the core benchmark is proven.

## suggested-next-version

Re-scope v0.1 around a smaller trust surface: one provider, private reports, hosted control-plane primitives, and a fully isolated capture sandbox with explicit retention/redaction and job-lease semantics. Do not ship permanent public reports, multi-provider fallback, or self-hosted Supabase until the benchmark passes and the security boundaries are specified in detail.

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-risk",
      "text": "The capture plane is the highest-risk component and the spec does not isolate it strongly enough. A Playwright container visiting arbitrary URLs can still hit internal services via subresources, redirects, WebSockets, service workers, DNS rebinding, or a browser escape; 'one container per capture' plus URL validation is not a real security boundary. v0.1 needs a hardened sandbox/microVM, default-deny egress, no cloud-metadata/VPC reachability, request interception, and strict CPU/memory/time limits.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Permanent public report URLs combined with stored screenshots, raw a11y dumps, and full LLM transcripts is a data-leak design. `noindex` does not protect sensitive pricing experiments, checkout content, consultant deliverables, or accidentally captured PII/secrets. Reports should be private-by-default, revocable/expiring, and backed by retention/redaction rules for debug artifacts.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The 'fresh-context' claim is undercut by the retry design. 'Your last response did not match schema, fix it' reuses the same conversation state, so prompt injection or earlier model state persists across retries. If isolation and reproducibility matter, retries must rebuild a brand-new request or repair JSON outside the model conversation.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Paired A/B isolation is not actually enforced. With concurrent workers, the same backstory can be sent to variant A and variant B at the same time unless there is a per-backstory lock or lease. `UNIQUE(study_id, backstory_id, variant_idx)` only prevents duplicate rows, not simultaneous cross-variant execution.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Cost and ledger correctness is specified more strongly than the implementation can guarantee. An external LLM call cannot be atomically included in the same transaction as a visit-row write; a crash after provider acceptance but before DB commit creates orphan spend, and retrying the job can double-charge. v0.1 needs idempotency keys per visit attempt, explicit reserve/commit/refund semantics, and provider-billing reconciliation.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The product captures arbitrary customer pages and then sends page content, custom ICP text, and cluster strings to multiple model and embedding providers by design, but the spec has no data-classification, provider-routing, redaction, or consent story. For CRO consultants and checkout pages, that is a trust/compliance blocker, not a later enhancement.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The Postgres `SKIP LOCKED` queue design is too thin for long-running Playwright and LLM jobs. Missing leases/heartbeats, visibility timeouts, attempt records, poison-job handling, and dead-lettering will leave `in_flight` work stranded or duplicated after restarts and network partitions.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Abuse controls are incomplete for a public render service. Basic Cloudflare WAF and per-account spend caps do not stop render bombs, huge DOMs, infinite scroll, large screenshots, asset floods, or high-cardinality URL abuse from exhausting worker CPU, memory, storage, and outbound bandwidth. v0.1 needs per-account/domain concurrency budgets, request/response caps, artifact size caps, navigation ceilings, and circuit breakers.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "v0.1 is carrying too much ops/product surface at once: self-hosted Supabase, preview env per PR, multi-provider fallback, permanent public reports, prepaid credits, and resumable orchestration. The real launch risk is evaluation quality; this scope materially increases incident probability before the core benchmark is proven.",
      "severity": "minor"
    },
    {
      "category": "missing-risk",
      "text": "API key handling is underspecified for incident response. One rotatable live key per account without scopes, expiry, last-used metadata, or a fast kill switch creates an unnecessarily large blast radius when a key leaks or an automation script is compromised.",
      "severity": "minor"
    },
    {
      "category": "missing-risk",
      "text": "The storage and backup plan mentions restore drills but not key management. With screenshots, transcripts, and raw page captures in object storage and backups, the spec should explicitly define encryption at rest, secret rotation, preview/staging/prod separation, and who can access artifacts.",
      "severity": "minor"
    }
  ],
  "summary": "The spec's biggest gap is containment and data minimization: arbitrary-page capture, persistent public artifacts, and multi-provider model routing create a much larger security and compliance surface than the document acknowledges. Several hard guarantees the product depends on - fresh context, paired isolation, exact spend accounting, and resumability - are also not actually enforced by the described implementation.",
  "suggested_next_version": "Re-scope v0.1 around a smaller trust surface: one provider, private reports, hosted control-plane primitives, and a fully isolated capture sandbox with explicit retention/redaction and job-lease semantics. Do not ship permanent public reports, multi-provider fallback, or self-hosted Supabase until the benchmark passes and the security boundaries are specified in detail.",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
