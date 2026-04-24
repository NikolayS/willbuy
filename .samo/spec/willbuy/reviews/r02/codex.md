# Reviewer A — Codex

## summary

The spec is much stronger than a typical AI-product draft, but the remaining gaps are concentrated at the real trust boundaries: untrusted-browser isolation, ambiguous egress policy, unsafe click automation, private/session URL handling, bearer-token/report hardening, and backup-aware deletion. The current v0.1 scope also adds preview-environment complexity before the sensitive-data model is actually closed.

## missing-risk

- (major) The capture boundary is underspecified: the untrusted browser/page renderer appears to run in the same sandboxed worker that also needs job/object-store credentials. Without a broker/sidecar that holds creds and mediates uploads/downloads, a browser escape becomes a direct credential-exfiltration event.
- (major) The data-leak model is too optimistic for checkout/authenticated URLs. Regex redaction of high-entropy strings, JWTs, and emails will miss names, addresses, phones, order IDs, hidden form values, shorter session/CSRF tokens, query params, and screenshot-visible PII, yet the spec still stores artifacts and sends captures to third-party providers.
- (major) The capture-authorization checkbox is not a real control for private or session-bound URLs. As written, any user can submit a tokenized checkout link or customer-specific page and cause its contents to be stored, analyzed, and shared with providers; v0.1 should either restrict to public pages only or require proof of control for non-public targets.
- (major) Share-link hardening is incomplete. If bearer tokens live in URLs and report pages load any external asset, the token can leak via `Referer`, logs, browser history, or CDN cache; the spec needs explicit `Referrer-Policy`, `Cache-Control: no-store/private`, same-origin asset rules, and a clear token placement strategy.
- (major) The report surface treats hostile text as data but never defines output sanitization. Captured page text, LLM reasoning, cluster labels, and objections can echo attacker-controlled HTML/JS; without mandatory escaping/sanitization and a restrictive CSP, this is a stored-XSS path on private and shared reports.
- (major) Deletion promises are not backup-safe. 'Delete now' and 'purge within 7 days' are misleading unless the spec defines backup retention, replica/snapshot handling, preview-environment data policy, and whether restored backups may temporarily resurrect supposedly deleted captures/transcripts.
- (major) Credit reservation is based on estimated cost, but actual spend can rise to the per-visit cap across retries plus aggregation/label calls. That under-collateralizes studies and turns retry storms or provider misbehavior into direct margin loss and account-cap bypass pressure.

## weak-implementation

- (major) The egress rule is internally inconsistent. 'Only target origin IPs' conflicts with 'target origin and its third-party subresources reachable'; without a precise per-request hostname allowlist and public-IP revalidation for every subresource, you either break modern pages or leave an SSRF/evasion hole through third-party assets, CNAME chains, and DNS changes.
- (major) Cookie-banner auto-dismiss is an unsafe generic clicker and contradicts the 'no follow-on clicks' boundary. On pricing/checkout pages it can trigger form submits, cart mutations, or consent side effects unless reduced to a tiny audited selector allowlist with no-navigation/no-submit guards.
- (major) The lease model lacks fencing. Heartbeats and visibility timeouts alone do not stop split-brain after pauses or partial failures; reclaimed jobs and zombie workers can both call providers or write terminal state unless every side effect is guarded by a lease-owner token or monotonic attempt number.

## unnecessary-scope

- (major) Preview environment per PR is high-risk, low-value scope for a v0.1 system handling third-party captures. It multiplies secret sprawl and configuration drift, and the spec does not define synthetic-only data, blocked prod-provider access, or KMS/DB isolation for previews.

## suggested-next-version

Cut preview-env-per-PR and non-public URL support from launch; require a brokered capture architecture with no credentials in the renderer sandbox, explicit subresource egress rules, no-mutation cookie handling, output sanitization plus CSP/referrer/cache controls on report pages, fenced leases, and backup-aware deletion semantics before calling the system production-ready.

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-risk",
      "text": "The capture boundary is underspecified: the untrusted browser/page renderer appears to run in the same sandboxed worker that also needs job/object-store credentials. Without a broker/sidecar that holds creds and mediates uploads/downloads, a browser escape becomes a direct credential-exfiltration event.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The egress rule is internally inconsistent. 'Only target origin IPs' conflicts with 'target origin and its third-party subresources reachable'; without a precise per-request hostname allowlist and public-IP revalidation for every subresource, you either break modern pages or leave an SSRF/evasion hole through third-party assets, CNAME chains, and DNS changes.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "Cookie-banner auto-dismiss is an unsafe generic clicker and contradicts the 'no follow-on clicks' boundary. On pricing/checkout pages it can trigger form submits, cart mutations, or consent side effects unless reduced to a tiny audited selector allowlist with no-navigation/no-submit guards.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The data-leak model is too optimistic for checkout/authenticated URLs. Regex redaction of high-entropy strings, JWTs, and emails will miss names, addresses, phones, order IDs, hidden form values, shorter session/CSRF tokens, query params, and screenshot-visible PII, yet the spec still stores artifacts and sends captures to third-party providers.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The capture-authorization checkbox is not a real control for private or session-bound URLs. As written, any user can submit a tokenized checkout link or customer-specific page and cause its contents to be stored, analyzed, and shared with providers; v0.1 should either restrict to public pages only or require proof of control for non-public targets.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Share-link hardening is incomplete. If bearer tokens live in URLs and report pages load any external asset, the token can leak via `Referer`, logs, browser history, or CDN cache; the spec needs explicit `Referrer-Policy`, `Cache-Control: no-store/private`, same-origin asset rules, and a clear token placement strategy.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "The report surface treats hostile text as data but never defines output sanitization. Captured page text, LLM reasoning, cluster labels, and objections can echo attacker-controlled HTML/JS; without mandatory escaping/sanitization and a restrictive CSP, this is a stored-XSS path on private and shared reports.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Deletion promises are not backup-safe. 'Delete now' and 'purge within 7 days' are misleading unless the spec defines backup retention, replica/snapshot handling, preview-environment data policy, and whether restored backups may temporarily resurrect supposedly deleted captures/transcripts.",
      "severity": "major"
    },
    {
      "category": "unnecessary-scope",
      "text": "Preview environment per PR is high-risk, low-value scope for a v0.1 system handling third-party captures. It multiplies secret sprawl and configuration drift, and the spec does not define synthetic-only data, blocked prod-provider access, or KMS/DB isolation for previews.",
      "severity": "major"
    },
    {
      "category": "weak-implementation",
      "text": "The lease model lacks fencing. Heartbeats and visibility timeouts alone do not stop split-brain after pauses or partial failures; reclaimed jobs and zombie workers can both call providers or write terminal state unless every side effect is guarded by a lease-owner token or monotonic attempt number.",
      "severity": "major"
    },
    {
      "category": "missing-risk",
      "text": "Credit reservation is based on estimated cost, but actual spend can rise to the per-visit cap across retries plus aggregation/label calls. That under-collateralizes studies and turns retry storms or provider misbehavior into direct margin loss and account-cap bypass pressure.",
      "severity": "major"
    }
  ],
  "summary": "The spec is much stronger than a typical AI-product draft, but the remaining gaps are concentrated at the real trust boundaries: untrusted-browser isolation, ambiguous egress policy, unsafe click automation, private/session URL handling, bearer-token/report hardening, and backup-aware deletion. The current v0.1 scope also adds preview-environment complexity before the sensitive-data model is actually closed.",
  "suggested_next_version": "Cut preview-env-per-PR and non-public URL support from launch; require a brokered capture architecture with no credentials in the renderer sandbox, explicit subresource egress rules, no-mutation cookie handling, output sanitization plus CSP/referrer/cache controls on report pages, fenced leases, and backup-aware deletion semantics before calling the system production-ready.",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
