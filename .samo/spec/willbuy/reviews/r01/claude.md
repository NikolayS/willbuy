# Reviewer B — Claude

## summary

Strong v0.1 scaffold that covers all nine mandatory baseline sections in form, with TDD call-outs, sprint parallelization, and explicit ship gates. Six notable problems need fixing before work begins: (1) the architecture diagram block is empty despite prose coverage of components; (2) 'no subscriptions' scope contradicts the '$29–99/mo' Sprint 3 target; (3) the paired-A/B isolation invariant in Section 2 is phrased in a way that literally forbids correct behavior and should be restated; (4) the reproducibility integration test will be flaky because LLM outputs aren't bit-identical across runs — scope it to pure layers or define tolerances; (5) the embedding provider path isn't specified and may not exist for every pluggable chat provider; (6) `next_action` has six categorical values but McNemar's binarization isn't defined, and paired-t is applied to a bounded integer without acknowledging the normality assumption. Minor issues cluster around unit economics, data retention, rate-limit numbers, retry policy for transient vs. schema errors, cap-refund semantics on partial finishes, and a weak single-annotator ground truth on the 5-page benchmark that currently gates ship.

## missing-requirement

- (major) Section 4 (Architecture) includes the component list, boundaries, and abstractions but the architecture diagram block is literally empty — it contains the placeholder `(architecture not yet specified)` between the `architecture:begin`/`end` markers. Mandatory baseline section #4 is only partially satisfied; the visual/topological architecture is absent and should be filled in before v0.1 is considered complete.
- (minor) No data retention policy is specified for captured screenshots, raw a11y-tree dumps, or full LLM transcripts (Section 4.1 states they are stored 'for debugging' only). Given third-party sites may be captured — potentially including post-auth or PII-bearing content — retention, deletion-on-request, and public-report-asset exposure rules should be in v0.1 scope alongside the `noindex` default for shareable URLs.
- (minor) Unit economics are absent from the spec. User story #2 asserts 'Total spend ~$3' for a 30-visit single-URL study, but there is no cost model tying (model, avg input tokens, avg output tokens, embedding calls, cluster-label calls) to a price, nor credit-pack sizing. The spend-cap feature in Section 5.4 and the Stripe credit ledger both depend on a per-visit cost estimator that isn't defined.
- (minor) The transactional-email path for the 50%-of-cap warning (Section 2 #18, Section 5.4) is not specified — no provider, no delivery guarantees, no template. Supabase Auth handles magic-link emails but is not typically used for product notifications. Sprint 2 assigns the feature to TS engineer B without naming the email backend.

## contradiction

- (major) Section 2 (Scope) states 'Stripe Checkout for prepaid credits (no subscriptions in v0.1). Credit ledger in Postgres.' and explicitly defers 'Stripe subscriptions / billing portal / dunning' to v0.2. However Section 8 Sprint 3 sets the commercial target as 'target 10 paid conversions at $29–99/mo within 4 weeks post-launch' — the `/mo` framing implies monthly subscriptions, directly contradicting the credits-only scope decision. Reconcile: either restate the goal as credit-pack equivalents (e.g. '$29–$99 first-pack purchases') or move subscriptions into v0.1 scope.

## ambiguity

- (major) Section 2 in-scope #6 defines the paired-A/B invariant as: 'Backstory string must never co-occur in both variants'' contexts simultaneously.' This is confusingly phrased — the whole point of paired A/B is that the same backstory DOES visit both variants (in independent fresh contexts). 'Simultaneously' doesn't capture the real invariant. The correct invariant (stated better in Section 4.2) is 'no shared memory/context across the two visits for the same backstory; the pairing is a DB join, not cross-call LLM memory.' Section 2 and the isolation test in 6.2 should use that wording so engineers don't implement the literal 'never co-occur' check (which would forbid correct behavior).
- (major) Section 5.3 specifies clustering as 'Embed each finding string via provider's embedding endpoint' and Section 2 in-scope #19 requires a pluggable LLM adapter with ≥2 backends. But not every LLM provider exposes an embedding endpoint (e.g. Anthropic does not ship a first-party embedding API). The spec doesn't say whether the embedding provider is independently selectable, whether there is a fixed embedding default regardless of the chat provider, or what happens if the selected provider has no embeddings. This ambiguity will block Sprint 2 aggregator work.
- (major) Section 2 in-scope #10 defines six `next_action` weights (purchase=1.0 … leave=0.0) used for the conversion-weighted score, while Section 2 #11 and Section 5.3 apply McNemar's on 'purchase/not-purchase' — a binary collapse. The spec never states the canonical binarization rule (is `contact_sales` a purchase-equivalent? is `signup_free` a purchase for free-tier products?), nor does it offer a configurable threshold. Two engineers will implement two different binarizations. Also, paired-t on a bounded 0–10 integer is named without acknowledging the normality assumption or offering Wilcoxon signed-rank as a non-parametric alternative.
- (major) Section 2 in-scope #8 specifies 'up to 2 retries per visit on schema violation', but the spec nowhere defines retry policy for transient LLM errors (timeouts, 429s, 5xx, provider outages) vs. schema violations. Section 4.2 mentions 'provider fallback on error' without quantifying attempts, backoff, or how the per-visit cost cap interacts with retries. The `Visit.status` enum (`pending|in_flight|ok|retrying|failed`) also doesn't distinguish schema-retry from provider-retry. Clarify: separate retry budgets per failure class, and whether provider-fallback attempts count against the 2-retry ceiling.
- (minor) Section 2 in-scope #20 specifies 'Graceful bot-detection failure … surface a clear error and refund credits.' But the detection logic is not defined — what signals count as 'blocked'? HTTP 403 from Cloudflare? Known challenge-page title strings? A timeout? DataDome-specific cookie set? Without a detection rule list, the capture worker will either under-detect (silently returning captcha HTML as 'content') or over-detect (refunding on unrelated errors). Section 5.1 step 3 also lumps this into capture status `blocked` without spelling out the classifier.
- (minor) Section 5.4 states that if the spend cap is hit mid-run, 'Study finishes `ready` if ≥ `min_ok_visits` (default 20/30); otherwise `failed`, credits refunded.' It doesn't state what happens to credits already debited for the `cap_exceeded` visits in a `ready` outcome (refunded? kept?), nor how the hold placed in Section 5.1 step 2 is reconciled with a partial finish. The credit-ledger TDD suite in 6.1 lists debit/hold/refund but no partial-finalize fixture.
- (minor) Section 2 in-scope #13 is 'Single-user API-key auth (one rotatable key per account).' With only one active key, rotation requires a hard cutover — any automation using the old key breaks at rotation time. Standard practice is a dual-key overlap window. Either explicitly accept the cutover trade-off (and document it), or allow 2 concurrent keys with explicit revoke.
- (minor) Cloudflare WAF rate limits are listed as in-scope (Section 2 #16, Section 4.1, Sprint 2) but the actual limits aren't quantified — no per-IP anon RPM, no per-API-key RPM, no concurrent-study cap. Engineers cannot implement or load-test this without numbers.
- (minor) The spec says 'Max 2 URLs per study in v0.1' and defines a paired-A/B flow in Section 5.1, but single-URL mode is only implied (User story #2 exercises it; Sprint 1 milestone mentions it). A Section 5.1 single-URL data-flow sibling is missing, leaving the single-URL implementation underspecified (e.g. is aggregation skipping paired-delta stats? Is clustering still run? What is the default N?).

## weak-testing

- (major) Section 6.2 mandates a 'Reproducibility — same seed + same fixtured pages → identical per-backstory deltas across two runs' integration test. Two independent LLM calls are not bit-identical even at temperature=0 on most hosted providers (shared-infra nondeterminism, tokenizer/float drift, provider-side caching changes). Either (a) scope the reproducibility test to pure layers only (backstory sampler, validator, aggregator math on fixtured LLM outputs) — which 6.1 already covers — or (b) define the tolerance explicitly (e.g. 'per-backstory delta within ±0.5; cluster labels match ≥80%'). As written, the test is guaranteed to be flaky on real providers and will either be disabled or produce false alarms.
- (minor) Section 6.3 makes the 5-pricing-page CRO benchmark a hard ship gate, with ground truth provided by a single external CRO expert's blind top-3 flags. One annotator is a weak oracle for a plausible-slop category; inter-rater disagreement is known to be high in CRO reviews. Strengthen with (a) ≥2 independent CRO experts and an inter-rater agreement threshold, (b) a published rubric for what counts as 'covered', or (c) a pre-registered list of obvious issues hand-seeded into fixture pages that the tool must surface.
- (minor) Section 6.2's paired-A/B isolation test asserts 'a backstory string never appears in the recorded transcript of the OTHER variant's call for that backstory.' This checks string leakage but not the stronger invariant that each call uses a fresh, stateless context (no conversation id reuse, no shared system cache key, no KV-cache reuse at the provider side). Add a test that asserts the two calls for a backstory have different provider-side request ids / no shared conversation handle, and that the prompt-assembly code path constructs a new message array from scratch per call.
- (minor) Section 6.3 names a 2-minute end-to-end budget as a hard ship gate but relies on a manual measurement. There's no automated perf regression test with a stub provider at realistic latencies, and no stated budget decomposition (capture ≤ Xs, per-visit p95 ≤ Ys, aggregation ≤ Zs). A ship gate with only manual enforcement will regress between releases undetected.

## suggested-next-version

v0.1.1

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-requirement",
      "text": "Section 4 (Architecture) includes the component list, boundaries, and abstractions but the architecture diagram block is literally empty — it contains the placeholder `(architecture not yet specified)` between the `architecture:begin`/`end` markers. Mandatory baseline section #4 is only partially satisfied; the visual/topological architecture is absent and should be filled in before v0.1 is considered complete.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "Section 2 (Scope) states 'Stripe Checkout for prepaid credits (no subscriptions in v0.1). Credit ledger in Postgres.' and explicitly defers 'Stripe subscriptions / billing portal / dunning' to v0.2. However Section 8 Sprint 3 sets the commercial target as 'target 10 paid conversions at $29–99/mo within 4 weeks post-launch' — the `/mo` framing implies monthly subscriptions, directly contradicting the credits-only scope decision. Reconcile: either restate the goal as credit-pack equivalents (e.g. '$29–$99 first-pack purchases') or move subscriptions into v0.1 scope.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Section 2 in-scope #6 defines the paired-A/B invariant as: 'Backstory string must never co-occur in both variants'' contexts simultaneously.' This is confusingly phrased — the whole point of paired A/B is that the same backstory DOES visit both variants (in independent fresh contexts). 'Simultaneously' doesn't capture the real invariant. The correct invariant (stated better in Section 4.2) is 'no shared memory/context across the two visits for the same backstory; the pairing is a DB join, not cross-call LLM memory.' Section 2 and the isolation test in 6.2 should use that wording so engineers don't implement the literal 'never co-occur' check (which would forbid correct behavior).",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "Section 6.2 mandates a 'Reproducibility — same seed + same fixtured pages → identical per-backstory deltas across two runs' integration test. Two independent LLM calls are not bit-identical even at temperature=0 on most hosted providers (shared-infra nondeterminism, tokenizer/float drift, provider-side caching changes). Either (a) scope the reproducibility test to pure layers only (backstory sampler, validator, aggregator math on fixtured LLM outputs) — which 6.1 already covers — or (b) define the tolerance explicitly (e.g. 'per-backstory delta within ±0.5; cluster labels match ≥80%'). As written, the test is guaranteed to be flaky on real providers and will either be disabled or produce false alarms.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Section 5.3 specifies clustering as 'Embed each finding string via provider's embedding endpoint' and Section 2 in-scope #19 requires a pluggable LLM adapter with ≥2 backends. But not every LLM provider exposes an embedding endpoint (e.g. Anthropic does not ship a first-party embedding API). The spec doesn't say whether the embedding provider is independently selectable, whether there is a fixed embedding default regardless of the chat provider, or what happens if the selected provider has no embeddings. This ambiguity will block Sprint 2 aggregator work.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Section 2 in-scope #10 defines six `next_action` weights (purchase=1.0 … leave=0.0) used for the conversion-weighted score, while Section 2 #11 and Section 5.3 apply McNemar's on 'purchase/not-purchase' — a binary collapse. The spec never states the canonical binarization rule (is `contact_sales` a purchase-equivalent? is `signup_free` a purchase for free-tier products?), nor does it offer a configurable threshold. Two engineers will implement two different binarizations. Also, paired-t on a bounded 0–10 integer is named without acknowledging the normality assumption or offering Wilcoxon signed-rank as a non-parametric alternative.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Section 2 in-scope #8 specifies 'up to 2 retries per visit on schema violation', but the spec nowhere defines retry policy for transient LLM errors (timeouts, 429s, 5xx, provider outages) vs. schema violations. Section 4.2 mentions 'provider fallback on error' without quantifying attempts, backoff, or how the per-visit cost cap interacts with retries. The `Visit.status` enum (`pending|in_flight|ok|retrying|failed`) also doesn't distinguish schema-retry from provider-retry. Clarify: separate retry budgets per failure class, and whether provider-fallback attempts count against the 2-retry ceiling.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "Section 6.3 makes the 5-pricing-page CRO benchmark a hard ship gate, with ground truth provided by a single external CRO expert's blind top-3 flags. One annotator is a weak oracle for a plausible-slop category; inter-rater disagreement is known to be high in CRO reviews. Strengthen with (a) ≥2 independent CRO experts and an inter-rater agreement threshold, (b) a published rubric for what counts as 'covered', or (c) a pre-registered list of obvious issues hand-seeded into fixture pages that the tool must surface.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "Section 6.2's paired-A/B isolation test asserts 'a backstory string never appears in the recorded transcript of the OTHER variant's call for that backstory.' This checks string leakage but not the stronger invariant that each call uses a fresh, stateless context (no conversation id reuse, no shared system cache key, no KV-cache reuse at the provider side). Add a test that asserts the two calls for a backstory have different provider-side request ids / no shared conversation handle, and that the prompt-assembly code path constructs a new message array from scratch per call.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Section 2 in-scope #20 specifies 'Graceful bot-detection failure … surface a clear error and refund credits.' But the detection logic is not defined — what signals count as 'blocked'? HTTP 403 from Cloudflare? Known challenge-page title strings? A timeout? DataDome-specific cookie set? Without a detection rule list, the capture worker will either under-detect (silently returning captcha HTML as 'content') or over-detect (refunding on unrelated errors). Section 5.1 step 3 also lumps this into capture status `blocked` without spelling out the classifier.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Section 5.4 states that if the spend cap is hit mid-run, 'Study finishes `ready` if ≥ `min_ok_visits` (default 20/30); otherwise `failed`, credits refunded.' It doesn't state what happens to credits already debited for the `cap_exceeded` visits in a `ready` outcome (refunded? kept?), nor how the hold placed in Section 5.1 step 2 is reconciled with a partial finish. The credit-ledger TDD suite in 6.1 lists debit/hold/refund but no partial-finalize fixture.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "Section 6.3 names a 2-minute end-to-end budget as a hard ship gate but relies on a manual measurement. There's no automated perf regression test with a stub provider at realistic latencies, and no stated budget decomposition (capture ≤ Xs, per-visit p95 ≤ Ys, aggregation ≤ Zs). A ship gate with only manual enforcement will regress between releases undetected.",
      "severity": "minor"
    },
    {
      "category": "missing-requirement",
      "text": "No data retention policy is specified for captured screenshots, raw a11y-tree dumps, or full LLM transcripts (Section 4.1 states they are stored 'for debugging' only). Given third-party sites may be captured — potentially including post-auth or PII-bearing content — retention, deletion-on-request, and public-report-asset exposure rules should be in v0.1 scope alongside the `noindex` default for shareable URLs.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Section 2 in-scope #13 is 'Single-user API-key auth (one rotatable key per account).' With only one active key, rotation requires a hard cutover — any automation using the old key breaks at rotation time. Standard practice is a dual-key overlap window. Either explicitly accept the cutover trade-off (and document it), or allow 2 concurrent keys with explicit revoke.",
      "severity": "minor"
    },
    {
      "category": "missing-requirement",
      "text": "Unit economics are absent from the spec. User story #2 asserts 'Total spend ~$3' for a 30-visit single-URL study, but there is no cost model tying (model, avg input tokens, avg output tokens, embedding calls, cluster-label calls) to a price, nor credit-pack sizing. The spend-cap feature in Section 5.4 and the Stripe credit ledger both depend on a per-visit cost estimator that isn't defined.",
      "severity": "minor"
    },
    {
      "category": "missing-requirement",
      "text": "The transactional-email path for the 50%-of-cap warning (Section 2 #18, Section 5.4) is not specified — no provider, no delivery guarantees, no template. Supabase Auth handles magic-link emails but is not typically used for product notifications. Sprint 2 assigns the feature to TS engineer B without naming the email backend.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "Cloudflare WAF rate limits are listed as in-scope (Section 2 #16, Section 4.1, Sprint 2) but the actual limits aren't quantified — no per-IP anon RPM, no per-API-key RPM, no concurrent-study cap. Engineers cannot implement or load-test this without numbers.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "The spec says 'Max 2 URLs per study in v0.1' and defines a paired-A/B flow in Section 5.1, but single-URL mode is only implied (User story #2 exercises it; Sprint 1 milestone mentions it). A Section 5.1 single-URL data-flow sibling is missing, leaving the single-URL implementation underspecified (e.g. is aggregation skipping paired-delta stats? Is clustering still run? What is the default N?).",
      "severity": "minor"
    }
  ],
  "summary": "Strong v0.1 scaffold that covers all nine mandatory baseline sections in form, with TDD call-outs, sprint parallelization, and explicit ship gates. Six notable problems need fixing before work begins: (1) the architecture diagram block is empty despite prose coverage of components; (2) 'no subscriptions' scope contradicts the '$29–99/mo' Sprint 3 target; (3) the paired-A/B isolation invariant in Section 2 is phrased in a way that literally forbids correct behavior and should be restated; (4) the reproducibility integration test will be flaky because LLM outputs aren't bit-identical across runs — scope it to pure layers or define tolerances; (5) the embedding provider path isn't specified and may not exist for every pluggable chat provider; (6) `next_action` has six categorical values but McNemar's binarization isn't defined, and paired-t is applied to a bounded integer without acknowledging the normality assumption. Minor issues cluster around unit economics, data retention, rate-limit numbers, retry policy for transient vs. schema errors, cap-refund semantics on partial finishes, and a weak single-annotator ground truth on the 5-page benchmark that currently gates ship.",
  "suggested_next_version": "v0.1.1",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
