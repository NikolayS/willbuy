# Reviewer B — Claude

## summary

Spec v0.2 is materially stronger than v0.1 on security, isolation, and ledger semantics, but ships with one self-contradicting promise (the changelog claims an architecture diagram that is still an empty placeholder) and several scaling ambiguities that block implementation: min_ok_visits is only defined for N=30, the credits→cents mapping is missing, the daily spend-cap default is unset, and the schema-repair vs transient-retry budget composition is undefined. Capture timing contradicts itself between §2 (45s) and §6.3 (30s assertion). Testing has gaps where it most matters for the wedge: paired-A/B isolation is verified only against a stub, the LLM adapter has no contract suite, sandbox containment omits IPv6 and GCP/Azure metadata even though §2 names them, and the semantic-stability check is excluded from CI gating. The 5-page human benchmark threshold is permissive enough that a slop-prone build could pass.

## missing-requirement

- (major) §4 Architecture: the architecture diagram block is an empty placeholder — `(architecture not yet specified)` between the `<!-- architecture:begin -->` / `<!-- architecture:end -->` markers. The mandatory baseline requires an architecture section, and §4.1/§4.2/§4.3 give component lists but no system-level diagram showing dataflow between Web, API, capture worker, visitor worker, aggregator, queue, Postgres, object store, Stripe, and Postmark.

## contradiction

- (major) §10 Changelog claims the v0.2 pass `Filled architecture diagram`, but the §4 architecture block is still the empty `(architecture not yet specified)` placeholder. Either the diagram was not actually filled, or the changelog overstates the work — these cannot both be true.
- (major) Capture wall-clock budget contradiction. §2 #2 sets the capture ceiling at `wall-clock ≤ 45 s`, but §6.3 'Perf regression' asserts `per-stage budget asserted (capture ≤ 30 s, per-visit p95 ≤ 5 s, aggregation ≤ 20 s)`. A capture that legitimately uses up to 45 s under §2 #2 will fail the §6.3 CI assertion. Pick one ceiling or define both (hard cap vs. perf target) explicitly.
- (minor) §7 calls out 'Veteran payments engineer (Stripe credits / ledger) (0.5)' and notes 'Can be one of the TS engineers if skill overlap is real', but §8 Sprint 1 already assigns 'Stripe Checkout + webhook (test mode), Postmark integration' to TS engineer B without naming the payments engineer in any sprint. Either remove the payments role and absorb it into TS engineer B explicitly, or add the 0.5 payments engineer to the sprint plan. As written, the team count and the sprint plan disagree.

## ambiguity

- (major) §5.4 defines `partial_finalize` with `min_ok_visits, default 20/30`, and §5.5 reuses `min_ok_visits` as the ready/failed gate. §2 says N can range 5–100, but the spec never says whether `min_ok_visits` is a fixed 20, a fixed 2/3 ratio of N, or only defined for N=30. For N=5 the 20/30 default is impossible to satisfy; for N=100 the threshold is unspecified. Define the function `min_ok_visits(N)`.
- (major) Credits-to-money mapping is undefined. §5.4 ledger semantics work in `cents` (`reserve(...cents)`, `commit(...cents)`), but §5.6 prices packs as `$29 (1,000 credits ≈ 285 visits)`, implying 1 credit ≠ 1 cent (1000 credits / $29 ≈ 3.45¢ per credit) and a markup over the 3.5¢ visit cost. Spec must state (a) the credit→cent conversion rate, (b) whether reservations debit credits or cents, and (c) how the markup is reconciled against `llm_spend_daily(cents)` so the cap and reconciliation jobs are unambiguous.
- (major) Retry budget composition is unclear. §2 #9 allows up to 2 schema-repair retries and §2 #10 allows up to 3 transient retries with the per-visit 5¢ cap as the only joint bound, but the spec never says (a) whether '3 attempts' in §2 #10 includes the first call or is 3 retries on top, (b) whether transient retries reset the schema-repair counter or vice-versa, or (c) the ordering when both error classes occur in one visit. §6.1 promises 'retry-budget boundaries' tests but cannot test boundaries that aren't specified.
- (major) §2 #20 mandates a 'Hard daily LLM-spend cap per account', §5.5 enforces it, and §6.2 tests boundaries at 49.9/50.0/99.9/100.0%, but the actual default cap value is never given. New accounts therefore have no defined initial cap, and §5.6 cost-pack tiers cannot be reasoned about against it.
- (minor) §7 lists exactly 2 conversion-research experts, but §6.3 says 'if [κ] below [0.6], a third reviewer adjudicates'. The third reviewer is unsourced — not in the team list, no role assignment, no budget. Either pre-name the third reviewer (e.g., the LLM expert acting as adjudicator with a defined rubric), or require a 3rd contracted CRO from the start.
- (minor) §5.1 step 4 says when a backstory's other variant is in flight, 'the job is requeued with backoff'. The backoff policy (initial delay, growth, jitter, max) is unspecified, distinct from the §2 #10 transient-error backoff. Under contention this is the difference between a study finishing in 2 min vs. spinning. Specify the per-backstory-lease backoff.
- (minor) §5.1 step 4 sets 'concurrency limit (default 20)' without scope qualifier — per worker process, per study, per account, or global? §2 #18 already defines 'concurrent in-flight studies per account ≤ 5' and §2 #24 defines per-domain concurrency, but per-visitor-worker concurrency is the one most relevant to the 2-min budget and is the one left ambiguous.
- (minor) §2 #5 allows custom-ICP authoring, and §5.7 'Backstory sampling' defines categorical distributions only for the 5 preset archetypes. How a custom ICP — which is partly free-text — is converted into the categorical distributions that `sampleBackstory` requires is unspecified. The §6.1 reproducibility test ('same seed + idx → identical backstory') cannot apply to custom ICPs without this.
- (minor) §2 #11 says clustering operates on '`objections[]` / `confusions[]` / `unanswered_blockers[]` across visitors' but does not say whether the three lists are pooled into one HDBSCAN run or clustered independently per category. The report UX implication (one cluster table vs. three) and the `min_cluster_size=3` semantics differ materially between the two interpretations.
- (minor) §6.3 lists 'willbuy.dev's own [pricing page]' as one of the 5 benchmark pages, but Sprint 3 dogfooding *creates and iterates on* willbuy.dev's pricing page in the same sprint as the benchmark gate. Sequence-of-events is unclear: is willbuy's own page a 5th data point in the κ ≥ 0.6 calculation (in which case the experts review a page that's still being iterated), or is it scored separately? The interaction between dogfood iteration and benchmark gating needs to be ordered.
- (minor) §2 #2 'navigation depth ≤ 1 (no follow-on clicks in v0.1)' contradicts §2 #1 'auto-dismiss cookie banners' implicitly — banner dismissal is a click. Either reword to 'no follow-on navigations beyond the initial URL' (treating banner dismissal as a same-page interaction), or carve out cookie-banner dismissal as the single permitted click and bound it (one click only, on a banner-classified element).

## weak-testing

- (major) §6.2 'Sandbox containment' tests `169.254.169.254`, `127.0.0.1`, RFC1918, and one internal hostname, but §2 #1 explicitly enumerates 'no IPv6 ULA' and 'no link-local' as required egress denies. Add IPv6 ULA (fc00::/7), IPv6 link-local (fe80::/10), IPv6 loopback (::1), and the GCP/Azure metadata endpoints (`metadata.google.internal`, `169.254.169.254` IMDSv1+v2, Azure IMDS) to the assertion set, since these are explicit promises in §2.
- (major) Semantic-stability regression check is excluded from CI gating ('runs nightly, NOT in CI gating'). A prompt-template change or model-version drift that silently degrades cluster-label match below 80% or pushes per-backstory delta variance above ±0.5 can land on `main` and reach prod between nightly runs. At minimum, gate merges on the most recent nightly result; better, run a fast subset (e.g., 1 fixture page, N=5 paired) inline.
- (major) §6.1 makes `LLMProvider` and `EmbeddingProvider` adapters core to the architecture but lists no test-first contract suite for the adapter interface itself: surfaced error classes (transient vs schema vs cap-exceeded vs auth), idempotency-key honoring, structured-output `response_format` round-trip, and per-attempt cost accounting. Without a contract test, the v0.2 'second wired backend' work has no fixture to satisfy.
- (major) Paired-A/B isolation tests in §6.2 run against a stub provider only. The wedge claim is real-provider isolation (no shared KV cache, no session id reuse). Add at least one nightly real-provider isolation check that asserts (a) the provider's request-id and conversation handle (where exposed) differ across the A and B calls for the same backstory, and (b) the idempotency key per attempt is unique. Without this, the technical wedge is enforced only against a stub.
- (major) §6.3 5-page benchmark sample (n=5) and pass criterion (top-3 covers ≥2 of the union of expert top-3, with 0 obvious false positives) is a thin ship gate for a 'plausible-slop' product. With 2 experts the union may be 3–6 issues, so 2/6 = 33% recall passes. Either raise the threshold (e.g., ≥ 3 of the union, or ≥ 2 of the *intersection*), grow the page count to 10, or add per-page minimum recall AND a per-page false-positive budget rather than 'obvious'.
- (minor) §6.3 'Restart-during-run drill' is 'one successful run' on staging — single trial of a recovery path. Resumability under partial failure is exactly the kind of behavior that fails 1-in-N times. Make it ≥3 trials, with at least one trial killing workers during the *aggregation* stage (not just visit-fan-out) and one trial killing the capture worker mid-capture, since §5.3 implies different reclaim semantics per job kind.
- (minor) §6.2 'Reproducibility (pure layers only)' covers backstory sampling and aggregator-on-fixtured-LLM-output, but does not test the truncation algorithm in §5.7 (priority-ordered greedy to 30k tokens). Truncation determines what the model actually sees and is the most pricing-relevant code path; add golden-file tests for ordering (pricing → above-fold → reading order) and boundary (just under / just over 30k tokens).

## suggested-next-version

v0.3

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-requirement",
      "text": "§4 Architecture: the architecture diagram block is an empty placeholder — `(architecture not yet specified)` between the `<!-- architecture:begin -->` / `<!-- architecture:end -->` markers. The mandatory baseline requires an architecture section, and §4.1/§4.2/§4.3 give component lists but no system-level diagram showing dataflow between Web, API, capture worker, visitor worker, aggregator, queue, Postgres, object store, Stripe, and Postmark.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "§10 Changelog claims the v0.2 pass `Filled architecture diagram`, but the §4 architecture block is still the empty `(architecture not yet specified)` placeholder. Either the diagram was not actually filled, or the changelog overstates the work — these cannot both be true.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "Capture wall-clock budget contradiction. §2 #2 sets the capture ceiling at `wall-clock ≤ 45 s`, but §6.3 'Perf regression' asserts `per-stage budget asserted (capture ≤ 30 s, per-visit p95 ≤ 5 s, aggregation ≤ 20 s)`. A capture that legitimately uses up to 45 s under §2 #2 will fail the §6.3 CI assertion. Pick one ceiling or define both (hard cap vs. perf target) explicitly.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§5.4 defines `partial_finalize` with `min_ok_visits, default 20/30`, and §5.5 reuses `min_ok_visits` as the ready/failed gate. §2 says N can range 5–100, but the spec never says whether `min_ok_visits` is a fixed 20, a fixed 2/3 ratio of N, or only defined for N=30. For N=5 the 20/30 default is impossible to satisfy; for N=100 the threshold is unspecified. Define the function `min_ok_visits(N)`.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Credits-to-money mapping is undefined. §5.4 ledger semantics work in `cents` (`reserve(...cents)`, `commit(...cents)`), but §5.6 prices packs as `$29 (1,000 credits ≈ 285 visits)`, implying 1 credit ≠ 1 cent (1000 credits / $29 ≈ 3.45¢ per credit) and a markup over the 3.5¢ visit cost. Spec must state (a) the credit→cent conversion rate, (b) whether reservations debit credits or cents, and (c) how the markup is reconciled against `llm_spend_daily(cents)` so the cap and reconciliation jobs are unambiguous.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "Retry budget composition is unclear. §2 #9 allows up to 2 schema-repair retries and §2 #10 allows up to 3 transient retries with the per-visit 5¢ cap as the only joint bound, but the spec never says (a) whether '3 attempts' in §2 #10 includes the first call or is 3 retries on top, (b) whether transient retries reset the schema-repair counter or vice-versa, or (c) the ordering when both error classes occur in one visit. §6.1 promises 'retry-budget boundaries' tests but cannot test boundaries that aren't specified.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #20 mandates a 'Hard daily LLM-spend cap per account', §5.5 enforces it, and §6.2 tests boundaries at 49.9/50.0/99.9/100.0%, but the actual default cap value is never given. New accounts therefore have no defined initial cap, and §5.6 cost-pack tiers cannot be reasoned about against it.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§7 lists exactly 2 conversion-research experts, but §6.3 says 'if [κ] below [0.6], a third reviewer adjudicates'. The third reviewer is unsourced — not in the team list, no role assignment, no budget. Either pre-name the third reviewer (e.g., the LLM expert acting as adjudicator with a defined rubric), or require a 3rd contracted CRO from the start.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.1 step 4 says when a backstory's other variant is in flight, 'the job is requeued with backoff'. The backoff policy (initial delay, growth, jitter, max) is unspecified, distinct from the §2 #10 transient-error backoff. Under contention this is the difference between a study finishing in 2 min vs. spinning. Specify the per-backstory-lease backoff.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.1 step 4 sets 'concurrency limit (default 20)' without scope qualifier — per worker process, per study, per account, or global? §2 #18 already defines 'concurrent in-flight studies per account ≤ 5' and §2 #24 defines per-domain concurrency, but per-visitor-worker concurrency is the one most relevant to the 2-min budget and is the one left ambiguous.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #5 allows custom-ICP authoring, and §5.7 'Backstory sampling' defines categorical distributions only for the 5 preset archetypes. How a custom ICP — which is partly free-text — is converted into the categorical distributions that `sampleBackstory` requires is unspecified. The §6.1 reproducibility test ('same seed + idx → identical backstory') cannot apply to custom ICPs without this.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #11 says clustering operates on '`objections[]` / `confusions[]` / `unanswered_blockers[]` across visitors' but does not say whether the three lists are pooled into one HDBSCAN run or clustered independently per category. The report UX implication (one cluster table vs. three) and the `min_cluster_size=3` semantics differ materially between the two interpretations.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 'Sandbox containment' tests `169.254.169.254`, `127.0.0.1`, RFC1918, and one internal hostname, but §2 #1 explicitly enumerates 'no IPv6 ULA' and 'no link-local' as required egress denies. Add IPv6 ULA (fc00::/7), IPv6 link-local (fe80::/10), IPv6 loopback (::1), and the GCP/Azure metadata endpoints (`metadata.google.internal`, `169.254.169.254` IMDSv1+v2, Azure IMDS) to the assertion set, since these are explicit promises in §2.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "Semantic-stability regression check is excluded from CI gating ('runs nightly, NOT in CI gating'). A prompt-template change or model-version drift that silently degrades cluster-label match below 80% or pushes per-backstory delta variance above ±0.5 can land on `main` and reach prod between nightly runs. At minimum, gate merges on the most recent nightly result; better, run a fast subset (e.g., 1 fixture page, N=5 paired) inline.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.1 makes `LLMProvider` and `EmbeddingProvider` adapters core to the architecture but lists no test-first contract suite for the adapter interface itself: surfaced error classes (transient vs schema vs cap-exceeded vs auth), idempotency-key honoring, structured-output `response_format` round-trip, and per-attempt cost accounting. Without a contract test, the v0.2 'second wired backend' work has no fixture to satisfy.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "Paired-A/B isolation tests in §6.2 run against a stub provider only. The wedge claim is real-provider isolation (no shared KV cache, no session id reuse). Add at least one nightly real-provider isolation check that asserts (a) the provider's request-id and conversation handle (where exposed) differ across the A and B calls for the same backstory, and (b) the idempotency key per attempt is unique. Without this, the technical wedge is enforced only against a stub.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.3 5-page benchmark sample (n=5) and pass criterion (top-3 covers ≥2 of the union of expert top-3, with 0 obvious false positives) is a thin ship gate for a 'plausible-slop' product. With 2 experts the union may be 3–6 issues, so 2/6 = 33% recall passes. Either raise the threshold (e.g., ≥ 3 of the union, or ≥ 2 of the *intersection*), grow the page count to 10, or add per-page minimum recall AND a per-page false-positive budget rather than 'obvious'.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.3 'Restart-during-run drill' is 'one successful run' on staging — single trial of a recovery path. Resumability under partial failure is exactly the kind of behavior that fails 1-in-N times. Make it ≥3 trials, with at least one trial killing workers during the *aggregation* stage (not just visit-fan-out) and one trial killing the capture worker mid-capture, since §5.3 implies different reclaim semantics per job kind.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 'Reproducibility (pure layers only)' covers backstory sampling and aggregator-on-fixtured-LLM-output, but does not test the truncation algorithm in §5.7 (priority-ordered greedy to 30k tokens). Truncation determines what the model actually sees and is the most pricing-relevant code path; add golden-file tests for ordering (pricing → above-fold → reading order) and boundary (just under / just over 30k tokens).",
      "severity": "minor"
    },
    {
      "category": "contradiction",
      "text": "§7 calls out 'Veteran payments engineer (Stripe credits / ledger) (0.5)' and notes 'Can be one of the TS engineers if skill overlap is real', but §8 Sprint 1 already assigns 'Stripe Checkout + webhook (test mode), Postmark integration' to TS engineer B without naming the payments engineer in any sprint. Either remove the payments role and absorb it into TS engineer B explicitly, or add the 0.5 payments engineer to the sprint plan. As written, the team count and the sprint plan disagree.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§6.3 lists 'willbuy.dev's own [pricing page]' as one of the 5 benchmark pages, but Sprint 3 dogfooding *creates and iterates on* willbuy.dev's pricing page in the same sprint as the benchmark gate. Sequence-of-events is unclear: is willbuy's own page a 5th data point in the κ ≥ 0.6 calculation (in which case the experts review a page that's still being iterated), or is it scored separately? The interaction between dogfood iteration and benchmark gating needs to be ordered.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #2 'navigation depth ≤ 1 (no follow-on clicks in v0.1)' contradicts §2 #1 'auto-dismiss cookie banners' implicitly — banner dismissal is a click. Either reword to 'no follow-on navigations beyond the initial URL' (treating banner dismissal as a same-page interaction), or carve out cookie-banner dismissal as the single permitted click and bound it (one click only, on a banner-classified element).",
      "severity": "minor"
    }
  ],
  "summary": "Spec v0.2 is materially stronger than v0.1 on security, isolation, and ledger semantics, but ships with one self-contradicting promise (the changelog claims an architecture diagram that is still an empty placeholder) and several scaling ambiguities that block implementation: min_ok_visits is only defined for N=30, the credits→cents mapping is missing, the daily spend-cap default is unset, and the schema-repair vs transient-retry budget composition is undefined. Capture timing contradicts itself between §2 (45s) and §6.3 (30s assertion). Testing has gaps where it most matters for the wedge: paired-A/B isolation is verified only against a stub, the LLM adapter has no contract suite, sandbox containment omits IPv6 and GCP/Azure metadata even though §2 names them, and the semantic-stability check is excluded from CI gating. The 5-page human benchmark threshold is permissive enough that a slop-prone build could pass.",
  "suggested_next_version": "v0.3",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
