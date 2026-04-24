# Reviewer A — Codex

## summary

The spec is strongest on sandbox language but weakest on actual data-flow minimization. The main problems are over-broad outbound browser behavior, weak controls around what customer-third-party data leaves the system and gets stored, and too much privileged infra/surface area for a first launch. Cut risky conveniences, narrow data retention, and make provider/backups/report-sharing constraints explicit before treating this as launch-ready.

## missing-risk

- (major) The capture network boundary is under-specified. Allowlisting resolved IPs plus "third-party subresources" does not constrain Chrome-originated fetch/XHR/WebSocket/WebRTC/service-worker traffic, and IP-only allowlists are unsafe on shared CDN IPs without host/SNI/certificate enforcement. v0.1 needs an explicit request-mediation layer that enforces scheme, method, host, redirect policy, and resource type, and blocks service workers, WebRTC, downloads, and non-HTTP(S) schemes.
- (major) The capture-authorization checkbox is not a real control against data exfiltration. Users can submit signed URLs, magic links, password-reset links, staging URLs with query tokens, or URLs with embedded credentials, and the system will replay them server-side and forward the resulting content to model providers. Reject credential-bearing URLs and common auth-token patterns in v0.1 instead of relying on user attestation.
- (major) The spec never requires zero-retention/no-training modes, DPAs, or regional data-handling guarantees from the chat and embedding providers. Merely surfacing the provider choice to the user is not a control when customer-third-party page content is being sent to one or two external vendors. v0.1 needs explicit provider data-handling requirements and a hard block on providers that cannot meet them.
- (major) Redaction only happens before model submission; there is no output-side scrub before persisting or rendering free-form fields like reasoning, questions, or transcripts. If the model echoes sensitive source text, that leak is stored for 30 days and can propagate into reports and share links. Add post-generation DLP/redaction or remove the free-form reasoning field from v0.1.
- (major) Bearer share tokens in the URL path are only safe if private-report routes are stripped of third-party assets and protected with strict Referrer-Policy/CSP. The spec does not say that, and automatic default token issuance increases accidental exposure through logs, browser history, screenshots, forwarded email, and analytics. Authenticated owner access should be the default; share links should be minted only on explicit request.
- (major) The deletion and retention promises are operationally incomplete because backups are mentioned only as restore drills. If Postgres or object-store backups preserve raw captures/transcripts past the 30-day TTL or 7-day account-delete window, the stated purge guarantees are false. v0.1 needs backup retention and delete-from-backups language, or much weaker user-facing deletion claims.
- (minor) Per-account and per-domain budgets do not stop multi-account abuse where the service is used to hit arbitrary third-party sites or burn capture/model spend. v0.1 needs global domain budgets, complaint-driven denylisting, stronger account trust gates than email alone, and an operator kill-switch for abuse incidents.

## weak-implementation

- (major) Cookie-banner auto-dismiss is an interaction engine on arbitrary third-party pages. On pricing and checkout flows it can mutate carts, accept upsells, submit forms, or trigger non-idempotent JS while still staying within "navigation depth ≤ 1." v0.1 needs a hard interaction policy (consent-close only, no POST/form submit/downloads, kill on unexpected navigation/state change) or this feature should be cut.
- (major) The redaction design is too weak for the claimed safety envelope. Regexes for high-entropy strings, JWTs, AWS keys, and emails will miss ordinary but sensitive content in a11y trees and screenshots such as names, addresses, order details, support tickets, contract terms, and app-specific identifiers, and v0.1 even allows redaction to be disabled per study. This creates false confidence around third-party data handling.
- (major) Attempt idempotency is not strong enough under ambiguous provider outcomes. A timeout after provider accept but before DB write can produce both orphan spend and replayed requests; a daily reconciliation job only detects damage after the fact. You need an explicit attempt state machine persisted before submit, after provider accept, and after response, plus a policy for accepted-but-unknown calls that forbids blind replay.

## unnecessary-scope

- (major) Persisting raw a11y dumps, screenshots, and full LLM transcripts for every run is unnecessary high-risk scope for v0.1. Those artifacts dominate breach impact, backup surface, and deletion complexity, while the product value is in aggregates. Raw artifacts should be opt-in debug data at most, ideally only for failed runs and only with explicit owner action.
- (major) Preview environment per PR is avoidable high-risk scope for a product that holds capture data, billing state, KMS-wrapped objects, and model-provider credentials. The spec does not forbid prod/live secrets in previews or address untrusted fork PRs. Either cut previews from v0.1 or make them UI-only with stub providers and zero privileged secrets.
- (major) Self-hosted Supabase, envelope-encrypted object storage, custom leases/DLQ, Stripe credits, Cloudflare WAF tuning, preview envs, and sandboxed browsing is too much privileged infrastructure for a benchmark-first launch. This is classic unnecessary scope that will consume the exact ops budget needed for sandbox hardening, deletion correctness, and abuse handling. Use managed auth/db/storage unless a concrete compliance requirement forces self-hosting.
- (minor) Decoupling the embedding provider from the chat provider in v0.1 doubles the external data-processor surface and legal/incident complexity for limited launch value. Unless the benchmark proves a material quality gain, keep embeddings local or on the same zero-retention provider for the first release.

## suggested-next-version

Reduce the next version to a security-first core: single-URL capture, managed auth/db/storage, no default share links, no default transcript retention, one zero-retention provider path, non-disableable redaction plus output scrub, explicit backup-deletion semantics, and a proxy-enforced capture sandbox with no clicks except tightly-vetted consent-close behavior. Add A/B, preview envs, extra providers, and richer sharing only after those controls are proven.

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-risk",
      "text": "The capture network boundary is under-specified. Allowlisting resolved IPs plus \"third-party subresources\" does not constrain Chrome-originated fetch/XHR/WebSocket/WebRTC/service-worker traffic, and IP-only allowlists are unsafe on shared CDN IPs without host/SNI/certificate enforcement. v0.1 needs an explicit request-mediation layer that enforces scheme, method, host, redirect policy, and resource type, and blocks service workers, WebRTC, downloads, and non-HTTP(S) schemes.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Cookie-banner auto-dismiss is an interaction engine on arbitrary third-party pages. On pricing and checkout flows it can mutate carts, accept upsells, submit forms, or trigger non-idempotent JS while still staying within \"navigation depth ≤ 1.\" v0.1 needs a hard interaction policy (consent-close only, no POST/form submit/downloads, kill on unexpected navigation/state change) or this feature should be cut.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The capture-authorization checkbox is not a real control against data exfiltration. Users can submit signed URLs, magic links, password-reset links, staging URLs with query tokens, or URLs with embedded credentials, and the system will replay them server-side and forward the resulting content to model providers. Reject credential-bearing URLs and common auth-token patterns in v0.1 instead of relying on user attestation.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The redaction design is too weak for the claimed safety envelope. Regexes for high-entropy strings, JWTs, AWS keys, and emails will miss ordinary but sensitive content in a11y trees and screenshots such as names, addresses, order details, support tickets, contract terms, and app-specific identifiers, and v0.1 even allows redaction to be disabled per study. This creates false confidence around third-party data handling.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The spec never requires zero-retention/no-training modes, DPAs, or regional data-handling guarantees from the chat and embedding providers. Merely surfacing the provider choice to the user is not a control when customer-third-party page content is being sent to one or two external vendors. v0.1 needs explicit provider data-handling requirements and a hard block on providers that cannot meet them.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Redaction only happens before model submission; there is no output-side scrub before persisting or rendering free-form fields like reasoning, questions, or transcripts. If the model echoes sensitive source text, that leak is stored for 30 days and can propagate into reports and share links. Add post-generation DLP/redaction or remove the free-form reasoning field from v0.1.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "Persisting raw a11y dumps, screenshots, and full LLM transcripts for every run is unnecessary high-risk scope for v0.1. Those artifacts dominate breach impact, backup surface, and deletion complexity, while the product value is in aggregates. Raw artifacts should be opt-in debug data at most, ideally only for failed runs and only with explicit owner action.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Bearer share tokens in the URL path are only safe if private-report routes are stripped of third-party assets and protected with strict Referrer-Policy/CSP. The spec does not say that, and automatic default token issuance increases accidental exposure through logs, browser history, screenshots, forwarded email, and analytics. Authenticated owner access should be the default; share links should be minted only on explicit request.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The deletion and retention promises are operationally incomplete because backups are mentioned only as restore drills. If Postgres or object-store backups preserve raw captures/transcripts past the 30-day TTL or 7-day account-delete window, the stated purge guarantees are false. v0.1 needs backup retention and delete-from-backups language, or much weaker user-facing deletion claims.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "Preview environment per PR is avoidable high-risk scope for a product that holds capture data, billing state, KMS-wrapped objects, and model-provider credentials. The spec does not forbid prod/live secrets in previews or address untrusted fork PRs. Either cut previews from v0.1 or make them UI-only with stub providers and zero privileged secrets.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "Self-hosted Supabase, envelope-encrypted object storage, custom leases/DLQ, Stripe credits, Cloudflare WAF tuning, preview envs, and sandboxed browsing is too much privileged infrastructure for a benchmark-first launch. This is classic unnecessary scope that will consume the exact ops budget needed for sandbox hardening, deletion correctness, and abuse handling. Use managed auth/db/storage unless a concrete compliance requirement forces self-hosting.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Attempt idempotency is not strong enough under ambiguous provider outcomes. A timeout after provider accept but before DB write can produce both orphan spend and replayed requests; a daily reconciliation job only detects damage after the fact. You need an explicit attempt state machine persisted before submit, after provider accept, and after response, plus a policy for accepted-but-unknown calls that forbids blind replay.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Per-account and per-domain budgets do not stop multi-account abuse where the service is used to hit arbitrary third-party sites or burn capture/model spend. v0.1 needs global domain budgets, complaint-driven denylisting, stronger account trust gates than email alone, and an operator kill-switch for abuse incidents.",
      "severity": "minor"
    },
    {
      "category": "unnecessary-scope",
      "text": "Decoupling the embedding provider from the chat provider in v0.1 doubles the external data-processor surface and legal/incident complexity for limited launch value. Unless the benchmark proves a material quality gain, keep embeddings local or on the same zero-retention provider for the first release.",
      "severity": "minor"
    }
  ],
  "summary": "The spec is strongest on sandbox language but weakest on actual data-flow minimization. The main problems are over-broad outbound browser behavior, weak controls around what customer-third-party data leaves the system and gets stored, and too much privileged infra/surface area for a first launch. Cut risky conveniences, narrow data retention, and make provider/backups/report-sharing constraints explicit before treating this as launch-ready.",
  "suggested_next_version": "Reduce the next version to a security-first core: single-URL capture, managed auth/db/storage, no default share links, no default transcript retention, one zero-retention provider path, non-disableable redaction plus output scrub, explicit backup-deletion semantics, and a proxy-enforced capture sandbox with no clicks except tightly-vetted consent-close behavior. Add A/B, preview envs, extra providers, and richer sharing only after those controls are proven.",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
