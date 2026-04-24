# Reviewer A — Codex

## summary

The spec has good security intent, but its actual trust boundaries are still soft: target authorization, side-effect-free capture, spend control, share-link containment, deletion, and preview infrastructure all rely on assumptions rather than enforceable controls. The highest-risk issue is that v0.1 still permits arbitrary sensitive-page capture and handling paths that are hard to contain once data leaves the browser sandbox.

## missing-risk

- (major) The `capture_authorized` checkbox is not a control. Any paid user could submit publicly reachable but non-owned targets such as staging URLs, signed preview links, passwordless checkout links, or competitor pages, and the system would forward captured content to third-party model providers. For v0.1, either require proof-of-control for non-public targets or restrict capture to clearly public pages.
- (major) Capture is treated as read-only, but executing full page JS plus auto-dismissing banners is not side-effect free. It can fire POST/beacon/WebSocket traffic, mutate carts or sessions, accept tracking, or trigger one-click flows on badly designed pages. The spec needs an explicit no-side-effects browser policy: block non-GETs, form submits, downloads, service workers, popups, and permissions, and prefer DOM-removal over arbitrary banner clicks.
- (major) Capability URLs for reports are only safe if every token-bearing response is `Cache-Control: no-store`, excluded from analytics/error reporting, stripped from Referer headers, and actively purged from CDN/browser caches on revoke or expiry. The current share-token model ignores the most common leak paths for bearer links.
- (major) Captured page text and model outputs are untrusted but later appear in dashboards, cluster labels, and share pages. The spec does not define the rendering boundary (escaping, markdown policy, CSP, prohibition on raw HTML rendering), so a malicious target page can become stored XSS or dashboard poisoning.
- (major) The retention story is incomplete. 'Delete within 7 days' and 30-day TTLs are not credible if raw URLs, transcripts, screenshots, and tokens still live in backups, worker logs, traces, Cloudflare logs, Postmark events, or provider-side retention. Those stores need explicit retention and purge semantics too.
- (major) Redaction is optional, regex-based, and only described before model submission. Raw a11y dumps, screenshots, and transcripts are still stored, and cluster/public outputs can re-expose anything the regex misses. Sensitive-data handling needs redact-before-persist for text, a policy for screenshots, and a second scrub before anything reaches a report or share link.
- (major) Preview environments are called out as standard infra, but the spec never states how secrets, provider keys, Stripe webhooks, and auth are isolated from untrusted PR code or forked repos. Without a hard rule here, preview deploys become a straightforward secret-exfiltration path.
- (major) The observability plan asks for request logs and cost telemetry, but there is no field-level logging policy. URLs, share tokens, provider payloads, and capture failures will leak into logs by default, creating a second sensitive data store with weaker retention and access controls than the primary database.

## weak-implementation

- (major) Spend-cap enforcement is racy under concurrency. Multiple workers can all observe remaining budget and start provider calls, overshooting daily and per-visit caps before any attempt row is committed. This needs a reservation model or serialized budget check before the outbound call, not a read-then-call pattern.
- (major) Retry safety assumes provider idempotency keys prevent duplicate billing and duplicate execution, which many model APIs do not guarantee for timeouts, resets, or unknown outcomes. The adapter contract needs explicit provider capability requirements, pessimistic local accounting, and a defined path for 'request maybe executed' states.
- (major) `Only the target origin and its third-party subresources are reachable` is too loose to be a meaningful default-deny promise. An attacker-controlled page can intentionally pull arbitrary third-party hosts, redirects, and CNAME-backed origins. The spec needs explicit policy for allowed subresource origins, redirect handling, per-request DNS pinning, and max distinct host counts.
- (major) `gVisor or Firecracker` leaves the primary containment boundary unresolved. Those are materially different isolation models with different compatibility and escape assumptions; this is not a swappable late decision. Security sign-off should not depend on a week-1 spike choosing the sandbox after the architecture is already committed.
- (major) Study finalization is under-specified for restarts and late-arriving visits. The spec says aggregation runs when visits reach terminal state or a 3-minute timeout, but it does not define a single-writer finalize invariant. That leaves room for duplicate aggregate jobs, late mutation after `ready`, or double finalize/refund behavior.

## unnecessary-scope

- (major) Self-hosted Supabase, custom KMS/envelope encryption, preview-env-per-PR, and microVM/gVisor browser capture in v0.1 create a large permanent ops surface before the core product is validated. That is unnecessary scope for an initial launch and materially increases both breach and outage probability.

## suggested-next-version

Narrow v0.1 around the real security boundary: require proof-of-control or public-only targets, choose one sandbox and specify its hardening profile, define a no-side-effects browser policy, add atomic spend reservations and idempotent study finalization, and write explicit cache/log/backup/provider-retention rules for every token-bearing or sensitive artifact. If scope must shrink further, drop self-hosted Supabase and preview-env-per-PR before launch.

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-risk",
      "text": "The `capture_authorized` checkbox is not a control. Any paid user could submit publicly reachable but non-owned targets such as staging URLs, signed preview links, passwordless checkout links, or competitor pages, and the system would forward captured content to third-party model providers. For v0.1, either require proof-of-control for non-public targets or restrict capture to clearly public pages.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Capture is treated as read-only, but executing full page JS plus auto-dismissing banners is not side-effect free. It can fire POST/beacon/WebSocket traffic, mutate carts or sessions, accept tracking, or trigger one-click flows on badly designed pages. The spec needs an explicit no-side-effects browser policy: block non-GETs, form submits, downloads, service workers, popups, and permissions, and prefer DOM-removal over arbitrary banner clicks.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Spend-cap enforcement is racy under concurrency. Multiple workers can all observe remaining budget and start provider calls, overshooting daily and per-visit caps before any attempt row is committed. This needs a reservation model or serialized budget check before the outbound call, not a read-then-call pattern.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Retry safety assumes provider idempotency keys prevent duplicate billing and duplicate execution, which many model APIs do not guarantee for timeouts, resets, or unknown outcomes. The adapter contract needs explicit provider capability requirements, pessimistic local accounting, and a defined path for 'request maybe executed' states.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "`Only the target origin and its third-party subresources are reachable` is too loose to be a meaningful default-deny promise. An attacker-controlled page can intentionally pull arbitrary third-party hosts, redirects, and CNAME-backed origins. The spec needs explicit policy for allowed subresource origins, redirect handling, per-request DNS pinning, and max distinct host counts.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Capability URLs for reports are only safe if every token-bearing response is `Cache-Control: no-store`, excluded from analytics/error reporting, stripped from Referer headers, and actively purged from CDN/browser caches on revoke or expiry. The current share-token model ignores the most common leak paths for bearer links.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Captured page text and model outputs are untrusted but later appear in dashboards, cluster labels, and share pages. The spec does not define the rendering boundary (escaping, markdown policy, CSP, prohibition on raw HTML rendering), so a malicious target page can become stored XSS or dashboard poisoning.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The retention story is incomplete. 'Delete within 7 days' and 30-day TTLs are not credible if raw URLs, transcripts, screenshots, and tokens still live in backups, worker logs, traces, Cloudflare logs, Postmark events, or provider-side retention. Those stores need explicit retention and purge semantics too.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Redaction is optional, regex-based, and only described before model submission. Raw a11y dumps, screenshots, and transcripts are still stored, and cluster/public outputs can re-expose anything the regex misses. Sensitive-data handling needs redact-before-persist for text, a policy for screenshots, and a second scrub before anything reaches a report or share link.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "`gVisor or Firecracker` leaves the primary containment boundary unresolved. Those are materially different isolation models with different compatibility and escape assumptions; this is not a swappable late decision. Security sign-off should not depend on a week-1 spike choosing the sandbox after the architecture is already committed.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "Self-hosted Supabase, custom KMS/envelope encryption, preview-env-per-PR, and microVM/gVisor browser capture in v0.1 create a large permanent ops surface before the core product is validated. That is unnecessary scope for an initial launch and materially increases both breach and outage probability.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Preview environments are called out as standard infra, but the spec never states how secrets, provider keys, Stripe webhooks, and auth are isolated from untrusted PR code or forked repos. Without a hard rule here, preview deploys become a straightforward secret-exfiltration path.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Study finalization is under-specified for restarts and late-arriving visits. The spec says aggregation runs when visits reach terminal state or a 3-minute timeout, but it does not define a single-writer finalize invariant. That leaves room for duplicate aggregate jobs, late mutation after `ready`, or double finalize/refund behavior.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The observability plan asks for request logs and cost telemetry, but there is no field-level logging policy. URLs, share tokens, provider payloads, and capture failures will leak into logs by default, creating a second sensitive data store with weaker retention and access controls than the primary database.",
      "severity": "major"
    }
  ],
  "summary": "The spec has good security intent, but its actual trust boundaries are still soft: target authorization, side-effect-free capture, spend control, share-link containment, deletion, and preview infrastructure all rely on assumptions rather than enforceable controls. The highest-risk issue is that v0.1 still permits arbitrary sensitive-page capture and handling paths that are hard to contain once data leaves the browser sandbox.",
  "suggested_next_version": "Narrow v0.1 around the real security boundary: require proof-of-control or public-only targets, choose one sandbox and specify its hardening profile, define a no-side-effects browser policy, add atomic spend reservations and idempotent study finalization, and write explicit cache/log/backup/provider-retention rules for every token-bearing or sensitive artifact. If scope must shrink further, drop self-hosted Supabase and preview-env-per-PR before launch.",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
