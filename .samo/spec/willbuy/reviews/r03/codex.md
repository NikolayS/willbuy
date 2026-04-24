# Reviewer A — Codex

## summary

The spec shows unusually strong intent, but several guarantees are stronger than the implementation actually described. The biggest issues are arbitrary public-site capture, an incomplete sandbox/network boundary, overclaimed 'no side effects' and deletion guarantees, and inconsistent retry/accounting semantics outside the happy-path visit call. There is also at least one major ops scope bomb in the per-PR isolated environment design.

## missing-risk

- (major) `authorization_mode: "public_declared"` is still effectively 'let authenticated users crawl arbitrary public production pages'. `robots.txt`, reachability, and a staging-host blocklist are not authorization, and the spec explicitly blesses competitor capture. That creates complaint/ToS/abuse risk and turns preview-probe heuristics into a security boundary. For v0.1, cut this mode or gate it behind stronger ownership proof/manual approval.
- (major) Running arbitrary third-party JS in Chromium is an ongoing browser-RCE exposure, not a one-time ship gate. The spec has no patch/update SLO for Chromium/Playwright/kernel/Firecracker, no image provenance/signing story, and no canary/rollback process for emergency browser updates. A prelaunch red-team does not cover the operational risk of an internet-facing crawler.
- (major) Redaction is applied to the a11y tree and report strings, but raw screenshots are retained for 30 days. Screenshots are the highest-risk artifact because they can contain checkout PII, billing data, email addresses, order numbers, or secrets in pixels, and none of the pre-persist redaction applies. In v0.1 they should be opt-in debug artifacts with a much shorter TTL or be OCR/scrubbed before storage.
- (major) Concurrency controls are mostly per-account/per-target, but there is no explicit global cap or provider-specific rate limiter for visitor calls, capture VMs, or public-declared probes. Under multi-tenant load, success turns into provider throttling, fleet exhaustion, and retry amplification across accounts. Global backpressure needs to be part of the design, not left to worker defaults.

## weak-implementation

- (major) The capture boundary is underspecified. A microVM that 'cannot reach internal services' still needs a concrete way to learn/permit dynamic third-party hosts during render and to return screenshots/a11y trees/status back to the platform. Without an explicit broker design (for example proxy/vsock/one-way artifact channel) the egress story is either not implementable or it quietly depends on undeclared internal/network paths.
- (major) The 'no-side-effects browser policy' overclaims what the controls actually provide. Blocking non-GET requests still allows GET pixels, analytics endpoints, signed one-time URLs, logout links, and other stateful GETs to fire during rendering. DOM-removing banners avoids one class of POST, but permitted GET subresources can still create customer-visible effects or leak visit metadata.
- (major) Share-token confidentiality is weaker than stated because the token lives in the path (`/r/<slug>`), while the Cloudflare control only strips query strings on `/r/*`. Application middleware cannot sanitize edge/CDN/WAF/access logs it never sees. Unless every upstream log source drops or hashes that path segment, the report-secrecy control is incomplete.
- (major) The retention/deletion story is internally inconsistent. The spec promises account deletion is fulfilled within 7 days and 'purges everything including backups', but later says backups have 14-day retention and depend on tombstone replay on restore. Tombstone replay does not remove deleted data from backup media; it only re-deletes after restore. The promise needs to be weakened or the backup design needs a real deletion/rekey strategy.
- (major) Cost control and reconciliation only model `visit_attempts`, but the system also makes study-level provider calls for embeddings and cluster labels. Those calls do not have a clear ledger object, idempotency story, or reconciliation path, so caps/refunds/discrepancy alerts can drift from actual spend. Every outbound provider call type needs the same accounting primitive.
- (major) The core fresh-context claim conflicts with the cost model. The spec forbids KV-cache reuse hints / `cached_prompt_id`, but the pricing section assumes prompt caching on the stable system block. Either prompt caching is allowed and needs a precise exception, or it is disallowed and the cost model is wrong. Leaving this ambiguous undermines the product's main isolation claim.
- (major) The provider-idempotency design is too weak as written. Idempotency keys are defined per `(visit_id, attempt_idx)`, but retries normally advance `attempt_idx`, which means the retried request gets a different idempotency key and provider dedupe cannot help when it matters most. You need a stable logical-request key reused across transport retries, with attempt records modeled separately.

## unnecessary-scope

- (minor) Per-PR dedicated Supabase + Stripe sandbox webhook + Postmark stream + LLM sub-key + KMS root is excessive v0.1 scope for a five-person team, and it materially increases secret sprawl, teardown drift, and misconfiguration risk. This is the wrong place to spend novelty budget before the core crawler/reporting path is proven.

## suggested-next-version

v0.3.1 should narrow v0.1 to verified-domain targets only, define the exact capture boundary broker and global backpressure model, make screenshots opt-in or scrubbed, fix token-in-path logging and backup-deletion claims, separate logical-request idempotency from attempt records, account for every provider call type, and either ban prompt caching or explicitly carve it out from the fresh-context guarantee. Simplify preview environments until the core system is stable.

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-risk",
      "text": "`authorization_mode: \"public_declared\"` is still effectively 'let authenticated users crawl arbitrary public production pages'. `robots.txt`, reachability, and a staging-host blocklist are not authorization, and the spec explicitly blesses competitor capture. That creates complaint/ToS/abuse risk and turns preview-probe heuristics into a security boundary. For v0.1, cut this mode or gate it behind stronger ownership proof/manual approval.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The capture boundary is underspecified. A microVM that 'cannot reach internal services' still needs a concrete way to learn/permit dynamic third-party hosts during render and to return screenshots/a11y trees/status back to the platform. Without an explicit broker design (for example proxy/vsock/one-way artifact channel) the egress story is either not implementable or it quietly depends on undeclared internal/network paths.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Running arbitrary third-party JS in Chromium is an ongoing browser-RCE exposure, not a one-time ship gate. The spec has no patch/update SLO for Chromium/Playwright/kernel/Firecracker, no image provenance/signing story, and no canary/rollback process for emergency browser updates. A prelaunch red-team does not cover the operational risk of an internet-facing crawler.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The 'no-side-effects browser policy' overclaims what the controls actually provide. Blocking non-GET requests still allows GET pixels, analytics endpoints, signed one-time URLs, logout links, and other stateful GETs to fire during rendering. DOM-removing banners avoids one class of POST, but permitted GET subresources can still create customer-visible effects or leak visit metadata.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Redaction is applied to the a11y tree and report strings, but raw screenshots are retained for 30 days. Screenshots are the highest-risk artifact because they can contain checkout PII, billing data, email addresses, order numbers, or secrets in pixels, and none of the pre-persist redaction applies. In v0.1 they should be opt-in debug artifacts with a much shorter TTL or be OCR/scrubbed before storage.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Share-token confidentiality is weaker than stated because the token lives in the path (`/r/<slug>`), while the Cloudflare control only strips query strings on `/r/*`. Application middleware cannot sanitize edge/CDN/WAF/access logs it never sees. Unless every upstream log source drops or hashes that path segment, the report-secrecy control is incomplete.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The retention/deletion story is internally inconsistent. The spec promises account deletion is fulfilled within 7 days and 'purges everything including backups', but later says backups have 14-day retention and depend on tombstone replay on restore. Tombstone replay does not remove deleted data from backup media; it only re-deletes after restore. The promise needs to be weakened or the backup design needs a real deletion/rekey strategy.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Cost control and reconciliation only model `visit_attempts`, but the system also makes study-level provider calls for embeddings and cluster labels. Those calls do not have a clear ledger object, idempotency story, or reconciliation path, so caps/refunds/discrepancy alerts can drift from actual spend. Every outbound provider call type needs the same accounting primitive.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The core fresh-context claim conflicts with the cost model. The spec forbids KV-cache reuse hints / `cached_prompt_id`, but the pricing section assumes prompt caching on the stable system block. Either prompt caching is allowed and needs a precise exception, or it is disallowed and the cost model is wrong. Leaving this ambiguous undermines the product's main isolation claim.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The provider-idempotency design is too weak as written. Idempotency keys are defined per `(visit_id, attempt_idx)`, but retries normally advance `attempt_idx`, which means the retried request gets a different idempotency key and provider dedupe cannot help when it matters most. You need a stable logical-request key reused across transport retries, with attempt records modeled separately.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Concurrency controls are mostly per-account/per-target, but there is no explicit global cap or provider-specific rate limiter for visitor calls, capture VMs, or public-declared probes. Under multi-tenant load, success turns into provider throttling, fleet exhaustion, and retry amplification across accounts. Global backpressure needs to be part of the design, not left to worker defaults.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "Per-PR dedicated Supabase + Stripe sandbox webhook + Postmark stream + LLM sub-key + KMS root is excessive v0.1 scope for a five-person team, and it materially increases secret sprawl, teardown drift, and misconfiguration risk. This is the wrong place to spend novelty budget before the core crawler/reporting path is proven.",
      "severity": "minor"
    }
  ],
  "summary": "The spec shows unusually strong intent, but several guarantees are stronger than the implementation actually described. The biggest issues are arbitrary public-site capture, an incomplete sandbox/network boundary, overclaimed 'no side effects' and deletion guarantees, and inconsistent retry/accounting semantics outside the happy-path visit call. There is also at least one major ops scope bomb in the per-PR isolated environment design.",
  "suggested_next_version": "v0.3.1 should narrow v0.1 to verified-domain targets only, define the exact capture boundary broker and global backpressure model, make screenshots opt-in or scrubbed, fix token-in-path logging and backup-deletion claims, separate logical-request idempotency from attempt records, account for every provider call type, and either ban prompt caching or explicitly carve it out from the fresh-context guarantee. Simplify preview environments until the core system is stable.",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
