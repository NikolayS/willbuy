# Reviewer B — Claude

## summary

v0.2 is a strong, broadly unambiguous revision that addresses the major round-1 themes (sandbox/SSRF, ledger semantics, paired-A/B isolation, retention, rate-limits, two-annotator benchmark, fresh-context schema repair). All nine mandatory sections are present, though the architecture section's diagram block is an empty placeholder. Remaining issues cluster around (a) internal version labels — the 'v0.2 vs v0.2-followup' muddle around chat-provider fallback, (b) unset numeric defaults — daily spend cap has no dollar value, and min_ok_visits=20 is incompatible with the stated N≥5 floor, (c) timeout/threshold alignment (30s navigation vs 45s wall-clock), and (d) a handful of weak-test gaps around share-token lifecycle, API-key rotation, DLQ alerting, cost-ceiling retry interaction, and concurrency-ceiling enforcement. None are architectural dealbreakers; all are tractable copy/test edits for v0.3.

## missing-requirement

- (major) §4 Architecture diagram is an empty placeholder: the ```text block between `<!-- architecture:begin -->` and `<!-- architecture:end -->` contains only '(architecture not yet specified)'. The mandatory architecture section exists in prose (§4.1 Components, §4.2 Boundaries, §4.3 Abstractions), but the visual/structural diagram promised by the placeholder is missing. Either fill the diagram (component + data-flow ASCII or mermaid) or delete the placeholder scaffold and state explicitly that prose replaces the diagram.

## contradiction

- (major) Study success threshold contradicts minimum N. §5.2 states 'Default N is 30; minimum 5, maximum 100 in v0.1.' §5.4 defines `partial_finalize` with 'min_ok_visits, default 20/30' and §5.5 says 'Study finishes `ready` if ≥ `min_ok_visits`; otherwise `failed`, full reserve refunded.' With N=5–19, min_ok_visits=20 is unreachable, so every small study would auto-fail and refund regardless of result quality. Define min_ok_visits as a ratio (e.g., ≥ ⌈0.66·N⌉) or a ceiling (min(20, N)), or raise the N floor to 20.

## ambiguity

- (major) 'v0.2' is overloaded and self-contradicting. The spec header is 'SPEC v0.2', yet §2 #10 says 'Provider-fallback is **deferred to v0.2**' and §2 #21 says 'Adding the second wired backend with automatic fallback is **v0.2**' — implying fallback ships in THIS version. The changelog clarifies 'chat-provider fallback moved to v0.2-followup' but 'v0.2-followup' appears nowhere else and is not in the 'Out of scope' list. Readers cannot tell whether fallback is in the current v0.2 scope, a future v0.2.x, or a v0.3 milestone. Introduce a clear product-version axis (e.g., product-v0.1 / product-v0.2) distinct from the spec-doc version, and reconcile all three passages.
- (major) Daily LLM-spend cap has no numeric default. §2 #20 mandates 'Hard daily LLM-spend cap per account with a 50%-of-cap warning email' and §5.5 references `daily_cap` in comparisons, but no dollar figure is set anywhere. §6.1 tests boundary behavior at 49.9/50/99.9/100% of cap without a defined cap value. Pick a v0.1 default (e.g., $20/day) and state it in §2 #20 and §5.5 — otherwise the ledger, tests, and ops runbook are under-specified.
- (major) Capture timeouts are inconsistent. §2 #2 sets wall-clock ≤ 45 s for capture. §2 #22 classifies as `blocked` when 'navigation timed out at >30 s on first paint.' These two thresholds can race: a slow-but-legitimate page that renders at 35 s would be recorded as `blocked` (triggering a refund) before the wall-clock ceiling fires as a breach. Clarify: is 30 s a first-paint timeout (distinct signal) or should it align with the 45 s wall-clock? Document priority order when multiple ceilings are approached.
- (minor) Semantic-stability metric is not operationally defined. §6.2 nightly check: 'cluster-label match ≥ 80% across two real-provider runs at temperature=0; per-backstory delta within ±0.5.' 'Cluster-label match' is not defined — is it token overlap, embedding cosine, bipartite matching on cluster centroids, or human adjudication? An 80% threshold on an undefined metric is ungameable only by accident. Define the matching function (e.g., 'bipartite max-cosine match on cluster centroids, threshold 0.7 per pair') and what '80%' measures over (pairs matched / total clusters in smaller run).
- (minor) Credit-to-dollar mapping is implicit and dual-valued. §5.6 says '$29 (1,000 credits ≈ 285 visits)'. Back-solving: 285 visits × 3.5¢ ≈ $10 of LLM cost, so internally 1 credit ≈ 1¢ of provider cost, but to the user 1 credit costs $0.029 (≈ 2.9× markup). The spec never states 'credits are denominated in LLM-cost cents with a fixed pack markup' or similar. Billing, ledger math, and ops-side reconciliation all ride on this mapping. State it explicitly in §5.4 or §5.6.
- (minor) HDBSCAN behavior on sparse findings is unspecified. §2 #11 fixes `min_cluster_size=3`. A study with N=5 may produce <3 findings in a category, or all findings may be noise points — HDBSCAN then returns zero clusters. §6.2 has no fixture for the 'no clusters emit' case. Document expected report behavior ('no clusters, show raw findings list') and add a test.
- (minor) Paired-A/B requeue backoff is unspecified. §5.1 step 4: 'if the other variant's visit for this backstory is in flight, the job is requeued with backoff.' No backoff curve (constant? exponential?), no maximum wait, no interaction with the 10-min lease. Under heavy contention a backstory could ping-pong on the queue indefinitely. Specify a backoff (e.g., 0.5 s jittered, capped at lease_until).
- (minor) Aggregator 3-minute hard timeout behavior is undefined. §5.1 step 6: 'When all 60 visits reach terminal state (or 3-min hard timeout).' What happens at timeout — does the aggregator run on whatever visits have landed (partial report with n_ok<N)? Does the study transition to `failed`? How does the credit-ledger `partial_finalize` behave when some visits are still `leased` (not terminal)? Document the timeout's terminal effect and ledger interaction.
- (minor) Truncation strategy is under-specified. §5.7: 'A11y-tree serialization ordered: pricing rows → above-fold CTAs → remaining reading order. Greedy truncate to 30k tokens.' 'Greedy' is ambiguous — does this mean 'append items in priority order until the budget is hit, then cut the next item mid-token,' or 'drop trailing items whole once the budget is exceeded'? How is 'pricing row' identified in the a11y tree (DOM heuristic? ARIA landmark?)? Specify or add a test fixture that locks the expected truncation behavior on a known page.
- (minor) v0.1-wired chat and embedding providers are not named. §2 #11 says 'a small dedicated embedding model from a provider with a public embeddings API' (unnamed) and §2 #21 says 'one wired chat backend' (unnamed). §5.9 says 'providers are recorded per study and surfaced to the user before submission,' which presupposes a concrete provider. Procurement, pricing (§5.6 derives 3.5¢/visit from 'the chosen v0.1 chat model'), and legal/data-processing agreements all depend on this choice. Name the v0.1 chat provider and embedding provider (or state explicitly: 'selection deferred; cost-model defaults assume a GPT-4o-class chat + small OSS-embedding tier').
- (minor) Share-token delivery mechanism is unspecified. §2 #14 and §5.8 describe '22-char unguessable share token' required to load `/r/<slug>`, but not how it is presented: path segment (`/r/<slug>/<token>`), query param (`?t=...`), cookie, or header. This matters for link-sharing ergonomics, referrer-leak exposure, and noindex behavior. Specify the wire format.
- (minor) §5.6 reference-run cost range is unjustified. User story #2 narration: 'Total spend ~$3 (60 visits across both runs at the v0.1 cost-model defaults; see §5.6).' §5.6 says 'doubled for re-run ≈ $2.10–$3 including embeddings and cluster labels.' Doubling $1.06 gives $2.12; the upper end $3 is ~41% above that with no explanation (retry budget? variance? embedding overage?). Either tighten the range to $2.10–$2.30 or document the variance source.

## weak-testing

- (major) No test asserts the per-visit cost ceiling actually caps total spend across retries. §2 #10 and §5.6 both call out the '5¢ per-visit hard ceiling caps total spend across all retries.' §6.1 tests 'retry-budget boundaries' but does not fixture the scenario where 2 schema-repair retries + 3 transient retries accumulate cost up to the ceiling and the final attempt is cut off. Add: 'retry storm reaches per-visit ceiling on attempt k, visit transitions to failed:cap_exceeded, attempt k+1 is never issued, refund fires.'
- (minor) Share-token lifecycle is under-tested. §5.8 says 'expired tokens 410 Gone' and §2 #14 allows revoke/expiry. §6 has no test for: (a) expired-token returns 410 not 404, (b) revoked-token behavior, (c) default 90-day expiry actually applied at token mint, (d) opt-in indexable vs default noindex meta-tag on report HTML. Add unit/integration coverage for each.
- (minor) API key rotation is under-tested. §2 #15 and §5.8 require ≤2 active keys, immediate revoke, `last_used_at`, optional `expires_at`. §6 does not test: (a) attempting to create a 3rd active key is rejected, (b) a revoked key authenticates 401, (c) `last_used_at` is updated on auth, (d) expired key 401s. Add tests.
- (minor) DLQ and alerting path is not test-covered. §5.3 says jobs exceeding `max_attempts` (default 5) move to DLQ 'for operator review.' §6 does not test: DLQ row creation on exhausted attempts, operator-facing alert/notification firing, replay semantics (can a DLQ'd job be resurrected?). Add an integration test fixture that forces 5 failed visit attempts and asserts DLQ row + alert.
- (minor) No load test covers the concurrent-study ceiling. §2 #18 sets 'concurrent in-flight studies per account ≤ 5' and §2 #24 adds per-domain concurrency budgets. §6.2 integration targets N=5 in <30 s and perf-regression runs a single N=30 study. Nothing asserts that the 6th concurrent study from one account is rejected (and with what error), nor that the per-domain budget actually gates a burst. Add a targeted integration test.

## suggested-next-version

v0.3

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-requirement",
      "text": "§4 Architecture diagram is an empty placeholder: the ```text block between `<!-- architecture:begin -->` and `<!-- architecture:end -->` contains only '(architecture not yet specified)'. The mandatory architecture section exists in prose (§4.1 Components, §4.2 Boundaries, §4.3 Abstractions), but the visual/structural diagram promised by the placeholder is missing. Either fill the diagram (component + data-flow ASCII or mermaid) or delete the placeholder scaffold and state explicitly that prose replaces the diagram.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "Study success threshold contradicts minimum N. §5.2 states 'Default N is 30; minimum 5, maximum 100 in v0.1.' §5.4 defines `partial_finalize` with 'min_ok_visits, default 20/30' and §5.5 says 'Study finishes `ready` if ≥ `min_ok_visits`; otherwise `failed`, full reserve refunded.' With N=5–19, min_ok_visits=20 is unreachable, so every small study would auto-fail and refund regardless of result quality. Define min_ok_visits as a ratio (e.g., ≥ ⌈0.66·N⌉) or a ceiling (min(20, N)), or raise the N floor to 20.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "'v0.2' is overloaded and self-contradicting. The spec header is 'SPEC v0.2', yet §2 #10 says 'Provider-fallback is **deferred to v0.2**' and §2 #21 says 'Adding the second wired backend with automatic fallback is **v0.2**' — implying fallback ships in THIS version. The changelog clarifies 'chat-provider fallback moved to v0.2-followup' but 'v0.2-followup' appears nowhere else and is not in the 'Out of scope' list. Readers cannot tell whether fallback is in the current v0.2 scope, a future v0.2.x, or a v0.3 milestone. Introduce a clear product-version axis (e.g., product-v0.1 / product-v0.2) distinct from the spec-doc version, and reconcile all three passages.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Daily LLM-spend cap has no numeric default. §2 #20 mandates 'Hard daily LLM-spend cap per account with a 50%-of-cap warning email' and §5.5 references `daily_cap` in comparisons, but no dollar figure is set anywhere. §6.1 tests boundary behavior at 49.9/50/99.9/100% of cap without a defined cap value. Pick a v0.1 default (e.g., $20/day) and state it in §2 #20 and §5.5 — otherwise the ledger, tests, and ops runbook are under-specified.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Capture timeouts are inconsistent. §2 #2 sets wall-clock ≤ 45 s for capture. §2 #22 classifies as `blocked` when 'navigation timed out at >30 s on first paint.' These two thresholds can race: a slow-but-legitimate page that renders at 35 s would be recorded as `blocked` (triggering a refund) before the wall-clock ceiling fires as a breach. Clarify: is 30 s a first-paint timeout (distinct signal) or should it align with the 45 s wall-clock? Document priority order when multiple ceilings are approached.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "No test asserts the per-visit cost ceiling actually caps total spend across retries. §2 #10 and §5.6 both call out the '5¢ per-visit hard ceiling caps total spend across all retries.' §6.1 tests 'retry-budget boundaries' but does not fixture the scenario where 2 schema-repair retries + 3 transient retries accumulate cost up to the ceiling and the final attempt is cut off. Add: 'retry storm reaches per-visit ceiling on attempt k, visit transitions to failed:cap_exceeded, attempt k+1 is never issued, refund fires.'",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Semantic-stability metric is not operationally defined. §6.2 nightly check: 'cluster-label match ≥ 80% across two real-provider runs at temperature=0; per-backstory delta within ±0.5.' 'Cluster-label match' is not defined — is it token overlap, embedding cosine, bipartite matching on cluster centroids, or human adjudication? An 80% threshold on an undefined metric is ungameable only by accident. Define the matching function (e.g., 'bipartite max-cosine match on cluster centroids, threshold 0.7 per pair') and what '80%' measures over (pairs matched / total clusters in smaller run).",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Credit-to-dollar mapping is implicit and dual-valued. §5.6 says '$29 (1,000 credits ≈ 285 visits)'. Back-solving: 285 visits × 3.5¢ ≈ $10 of LLM cost, so internally 1 credit ≈ 1¢ of provider cost, but to the user 1 credit costs $0.029 (≈ 2.9× markup). The spec never states 'credits are denominated in LLM-cost cents with a fixed pack markup' or similar. Billing, ledger math, and ops-side reconciliation all ride on this mapping. State it explicitly in §5.4 or §5.6.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "HDBSCAN behavior on sparse findings is unspecified. §2 #11 fixes `min_cluster_size=3`. A study with N=5 may produce <3 findings in a category, or all findings may be noise points — HDBSCAN then returns zero clusters. §6.2 has no fixture for the 'no clusters emit' case. Document expected report behavior ('no clusters, show raw findings list') and add a test.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Paired-A/B requeue backoff is unspecified. §5.1 step 4: 'if the other variant's visit for this backstory is in flight, the job is requeued with backoff.' No backoff curve (constant? exponential?), no maximum wait, no interaction with the 10-min lease. Under heavy contention a backstory could ping-pong on the queue indefinitely. Specify a backoff (e.g., 0.5 s jittered, capped at lease_until).",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Aggregator 3-minute hard timeout behavior is undefined. §5.1 step 6: 'When all 60 visits reach terminal state (or 3-min hard timeout).' What happens at timeout — does the aggregator run on whatever visits have landed (partial report with n_ok<N)? Does the study transition to `failed`? How does the credit-ledger `partial_finalize` behave when some visits are still `leased` (not terminal)? Document the timeout's terminal effect and ledger interaction.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "Share-token lifecycle is under-tested. §5.8 says 'expired tokens 410 Gone' and §2 #14 allows revoke/expiry. §6 has no test for: (a) expired-token returns 410 not 404, (b) revoked-token behavior, (c) default 90-day expiry actually applied at token mint, (d) opt-in indexable vs default noindex meta-tag on report HTML. Add unit/integration coverage for each.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "API key rotation is under-tested. §2 #15 and §5.8 require ≤2 active keys, immediate revoke, `last_used_at`, optional `expires_at`. §6 does not test: (a) attempting to create a 3rd active key is rejected, (b) a revoked key authenticates 401, (c) `last_used_at` is updated on auth, (d) expired key 401s. Add tests.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Truncation strategy is under-specified. §5.7: 'A11y-tree serialization ordered: pricing rows → above-fold CTAs → remaining reading order. Greedy truncate to 30k tokens.' 'Greedy' is ambiguous — does this mean 'append items in priority order until the budget is hit, then cut the next item mid-token,' or 'drop trailing items whole once the budget is exceeded'? How is 'pricing row' identified in the a11y tree (DOM heuristic? ARIA landmark?)? Specify or add a test fixture that locks the expected truncation behavior on a known page.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "v0.1-wired chat and embedding providers are not named. §2 #11 says 'a small dedicated embedding model from a provider with a public embeddings API' (unnamed) and §2 #21 says 'one wired chat backend' (unnamed). §5.9 says 'providers are recorded per study and surfaced to the user before submission,' which presupposes a concrete provider. Procurement, pricing (§5.6 derives 3.5¢/visit from 'the chosen v0.1 chat model'), and legal/data-processing agreements all depend on this choice. Name the v0.1 chat provider and embedding provider (or state explicitly: 'selection deferred; cost-model defaults assume a GPT-4o-class chat + small OSS-embedding tier').",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "DLQ and alerting path is not test-covered. §5.3 says jobs exceeding `max_attempts` (default 5) move to DLQ 'for operator review.' §6 does not test: DLQ row creation on exhausted attempts, operator-facing alert/notification firing, replay semantics (can a DLQ'd job be resurrected?). Add an integration test fixture that forces 5 failed visit attempts and asserts DLQ row + alert.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "No load test covers the concurrent-study ceiling. §2 #18 sets 'concurrent in-flight studies per account ≤ 5' and §2 #24 adds per-domain concurrency budgets. §6.2 integration targets N=5 in <30 s and perf-regression runs a single N=30 study. Nothing asserts that the 6th concurrent study from one account is rejected (and with what error), nor that the per-domain budget actually gates a burst. Add a targeted integration test.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Share-token delivery mechanism is unspecified. §2 #14 and §5.8 describe '22-char unguessable share token' required to load `/r/<slug>`, but not how it is presented: path segment (`/r/<slug>/<token>`), query param (`?t=...`), cookie, or header. This matters for link-sharing ergonomics, referrer-leak exposure, and noindex behavior. Specify the wire format.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.6 reference-run cost range is unjustified. User story #2 narration: 'Total spend ~$3 (60 visits across both runs at the v0.1 cost-model defaults; see §5.6).' §5.6 says 'doubled for re-run ≈ $2.10–$3 including embeddings and cluster labels.' Doubling $1.06 gives $2.12; the upper end $3 is ~41% above that with no explanation (retry budget? variance? embedding overage?). Either tighten the range to $2.10–$2.30 or document the variance source.",
      "severity": "minor"
    }
  ],
  "summary": "v0.2 is a strong, broadly unambiguous revision that addresses the major round-1 themes (sandbox/SSRF, ledger semantics, paired-A/B isolation, retention, rate-limits, two-annotator benchmark, fresh-context schema repair). All nine mandatory sections are present, though the architecture section's diagram block is an empty placeholder. Remaining issues cluster around (a) internal version labels — the 'v0.2 vs v0.2-followup' muddle around chat-provider fallback, (b) unset numeric defaults — daily spend cap has no dollar value, and min_ok_visits=20 is incompatible with the stated N≥5 floor, (c) timeout/threshold alignment (30s navigation vs 45s wall-clock), and (d) a handful of weak-test gaps around share-token lifecycle, API-key rotation, DLQ alerting, cost-ceiling retry interaction, and concurrency-ceiling enforcement. None are architectural dealbreakers; all are tractable copy/test edits for v0.3.",
  "suggested_next_version": "v0.3",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
