# Reviewer B — Claude

## summary

v0.3 is materially stronger than v0.2 — target authorization, atomic spend reservation, render boundary, redaction, share-token leak controls, and per-backstory lease are all well-specified. Two structural blockers remain. (1) The architecture diagram is still an empty placeholder despite the changelog claiming it was filled — this leaves §4 substantively missing and the changelog directly contradicted. (2) `min_ok_visits(n)` is undefined for paired A/B mode (visits vs. backstories), which is load-bearing for ledger finalization and statistical validity. Two implementation-impossibility issues need correction before v0.4: an 'Anthropic official tokenizer library' that does not publicly exist (§2 #6), and HDBSCAN at runtime in a TypeScript-only stack with no named JS implementation or Python carve-out (§2 #14). The per-backstory lease can expire while a visit is mid-call (120 s lease vs. potentially longer retry budgets), reintroducing the very cross-variant overlap the lease was added to prevent. Wilcoxon tie-handling on integer 0–10 deltas is unspecified and changes reported p-values. Test-side: the 5-page benchmark omits ecommerce despite a flagship Shopify user story; the paired-isolation test doesn't specify a match method; semantic stability is nightly-only. Recommend v0.4 to fix the architecture diagram and the four major-correctness items, with the test-coverage strengthening folded in.

## missing-requirement

- (major) Mandatory section 4 (Architecture) contains an empty placeholder: the architecture code block reads literally `(architecture not yet specified)` between the `<!-- architecture:begin -->` and `<!-- architecture:end -->` markers. The spec relies on this diagram (§4.1: 'tables listed in the diagram'), and the v0.3 changelog item (14) explicitly claims 'architecture diagram filled' — but it is not. A reader cannot reconstruct component/data-flow topology from prose alone (which workers connect to which queues/buses, where redaction sits in the pipeline, where the per-backstory lease lives relative to the visit job lease).

## contradiction

- (major) v0.3 changelog item (14) states 'architecture diagram filled', but the §4 diagram block is the placeholder `(architecture not yet specified)`. The changelog claim is false against the current spec body.
- (major) §2 #6 specifies token measurement via 'Anthropic's official tokenizer library pinned by version in package.json'. Anthropic does not ship an official public client-side tokenizer library for Claude 3+/Claude 4 family models (claude-haiku-4-5 included); token counting for these models is exposed only via the API `count_tokens` endpoint (or approximated). Pinning a non-existent library in package.json is unimplementable as written, and §6.2 'truncator (pinned tokenizer)' inherits the same issue.
- (minor) User story #2 states 'Total spend ~$3 (60 visits at v0.1 cost-model defaults; see §5.6)', but §5.6's worked example computes 30 visits × 3.5¢ + 1.5¢ ≈ $1.06, ergo two runs ≈ $2.10–$2.13. The user-story figure is ~40% above the cost-model figure it cites. Either correct the story to ~$2 or correct the cost-model worked example.

## ambiguity

- (major) §5.4's ship-criterion `count(ok) ≥ min_ok_visits(n)` is undefined for paired A/B mode. With N=30 paired backstories there are 60 total visits. Does `n` denote the 30 backstories or the 60 visit slots? Does `count(ok)` count individual ok visits or paired backstories where BOTH variants are ok? Paired statistics (paired-δ, paired-t, Wilcoxon, McNemar) are only computable on backstories with both visits ok, so a single-visit-ok count would let a study reach `ready` with degenerate paired output. This is a load-bearing definition for the entire ledger `partial_finalize` and finalization flow and must be specified per mode.
- (major) HDBSCAN clustering (§2 #14, §5.7) is part of the runtime aggregator, but §1 mandates 'TypeScript end-to-end (Node 20…)' and 'Python is permitted for offline eval scripts only'. The mainstream HDBSCAN implementation is the Python `hdbscan` package; no JS-native equivalent is named, no out-of-process Python service is specified, and the cross-language boundary, determinism guarantees across that boundary, and deployment surface are all unaddressed. Either name a TS-callable HDBSCAN implementation (with its own determinism contract) or carve a runtime-Python exception with the IPC/packaging plan.
- (major) §2 #10 sets a 120 s per-backstory lease with 15 s heartbeat and §5.11 says the lease is released 'on visit terminal commit OR on `backstory_leases.lease_until` expiry'. But a visit job's outer lease is 10 min (§2 #26) and a single LLM call plus 2 schema repairs plus 3 transient retries with 0.5→2→8 s backoff can plausibly run >120 s. If the per-backstory lease expires while variant A is still mid-call, variant B can acquire it and start in parallel — directly violating the 'no two visits for the same backstory in flight simultaneously' invariant the lease exists to enforce. Spec needs either a heartbeat-driven extension rule for the per-backstory lease, or an explicit upper bound on a single visit's wall-clock that is < 120 s, or a coordinator that re-checks lease ownership before sending the request.
- (major) §2 #16 reports Wilcoxon signed-rank on `will_to_buy` deltas, but `will_to_buy` is an integer 0–10 (§2 #11), so paired deltas have a small support and many zero/tied differences. Wilcoxon's behavior on ties (drop zero-diff pairs? Pratt's correction? mid-rank?) and on the small sample sizes implied by `min_ok_visits(n)` (e.g., n=5 → 5 pairs) is unspecified, and the reported p-values can swing materially across these conventions. Pin the tie-handling rule and add a minimum-pairs threshold below which Wilcoxon is suppressed in favor of CI-only reporting.
- (minor) §2 #1 mandates 'an automated public-reachability probe run from an off-network checker' but never defines what 'off-network' means here. Is it a separate VPC/AS, a third-party service, a different cloud account, a Cloudflare Worker? This is a security-relevant control (proving the URL is publicly reachable, not just reachable from the requester's privileged network); without an architectural anchor it can be implemented in a way that defeats the intent.
- (minor) §2 #13 'Up to 3 attempts with jittered exponential backoff (0.5 s → 2 s → 8 s)' is ambiguous about whether 3 = total attempts (initial + 2 retries) or 3 = retries on top of the initial. The 3 backoff values listed suggest either reading. Pin the count and add it to the §6.1 retry-budget-boundary tests.
- (minor) For the v0.1 wired chat provider (claude-haiku-4-5 / Anthropic), §2 #13 / §5.6 / §6.2 don't state whether the provider's `idempotency_key` capability flag will be true or false. This determines whether `indeterminate`/reconciliation paths actually exercise in v0.1 or are dead code, and gates whether §6.2's reconciliation tests can hit a real provider failure mode vs. only a stub. State the v0.1 provider's capability flag explicitly and reference whichever Anthropic API contract supports it.
- (minor) §2 #5 lists 'DOM node count ≤ 250k' and 'total bytes downloaded ≤ 25 MB' as capture ceilings but doesn't specify enforcement mechanism (CDP heap snapshots? periodic `document.querySelectorAll('*').length` polls? response-body byte counter in the route handler?) or polling cadence. A pure post-hoc check after `networkidle` cannot prevent OOM during render; tests in §6.2 'Render-bomb' should specify what they assert about the enforcement path, not just the limit.
- (minor) §5.11 sets the aggregate timeout at 3 min from `studies.created_at`, but §2 #26 gives visit jobs a 10-min lease, and the spec allows a still-leased visit past the 3-min mark to complete and route to `late_arrivals`. With paired A/B requiring both visits ok per backstory for paired stats, a slow tail of late-arriving second visits would silently shrink usable paired-N without ever appearing in the report. Spec should either (i) wait up to the visit-lease horizon before finalizing paired runs, (ii) define a separate, longer paired-aggregate timeout, or (iii) explicitly document that paired-N can be reduced by `late_arrivals` and surface that count in the report.
- (minor) §2 #25 includes 'navigation timed out > 30 s on first paint AND DOM text content < 200 chars' as a `blocked` signal, but the overall capture wall-clock is ≤ 45 s (§2 #5). The 30 s 'first paint' threshold and the 45 s wall-clock cap interact unclearly: a slow but legitimate page that paints at 35 s with rich content would breach wall-clock but not match the blocked signal — what's its terminal classification (`error`? `blocked`? credit-refund behavior)? Add the breach→classification mapping for the 30 s ≤ first-paint ≤ 45 s window.

## weak-testing

- (major) §6.1 `paired-A/B isolation` test (a) asserts 'a backstory never appears in the OTHER variant's recorded transcript' but does not specify the matching method. Exact-substring search will trivially pass while still permitting paraphrased context bleed; semantic-similarity matching has no threshold defined; and the test as written cannot detect an LLM provider that silently caches a previous-call summary server-side. Strengthen by (i) asserting at adapter boundary that the outbound message array contains zero shared bytes with the other variant's array beyond the redacted a11y tree, (ii) asserting the adapter never sets continuation identifiers (already covered by adapter-lint, but cross-link it here), and (iii) specifying the substring/embedding threshold.
- (major) §6.3 5-page benchmark uses only 5 pages with κ≥0.6 (moderate agreement) as the hard ship gate, with all 5 pages from SaaS/devtools (Stripe, Linear, Supabase, PostHog, willbuy itself). User story #2 is explicitly Shopify ecommerce checkout, yet no ecommerce page is in the benchmark, so the gate provides zero evidence the tool generalizes to a primary advertised use case. Either add an ecommerce checkout page (e.g., a real Shopify store with permission) to the benchmark, or scope the v0.1 launch claim to SaaS/landing only.
- (minor) §6.2 explicitly carves out semantic stability ('cluster-label ≥80% match at temperature=0; per-backstory δ within ±0.5') from CI gating and runs it nightly only. Semantic stability is the single most user-visible quality property of the product (the same backstory + same page should produce a stable verdict). Nightly-only failure means a regression can ship for ≥1 day before detection. At minimum, gate PRs on a small (e.g., 3-page × 5-backstory) sampled stability suite with the same thresholds; keep the full nightly as the broader corpus.
- (minor) §6.1 `sampleBackstory` test 'marginals match ICP spec over N=10k within tolerance' leaves 'tolerance' undefined, so the test is unfalsifiable. Pin a chi-square or KL threshold per archetype, or assert per-bin proportions within ±2% / ±3σ of the declared distribution.
- (minor) §6.2 reproducibility test claims 'sorted-input + fixed random_state guarantees float stability across CPUs' for HDBSCAN. Even with fixed seeds, libm/BLAS/SIMD differences across CPUs (and between dev macOS arm64 and prod Linux x86_64) can produce different floating-point distance computations and thus different cluster assignments at boundary points. Either run the determinism test pinned to a single architecture (and gate prod on that arch), or use a higher-level invariant (e.g., 'cluster count within ±1' / 'cluster-label set Jaccard ≥ 0.9') instead of bit-identity.

## suggested-next-version

0.4

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-requirement",
      "text": "Mandatory section 4 (Architecture) contains an empty placeholder: the architecture code block reads literally `(architecture not yet specified)` between the `<!-- architecture:begin -->` and `<!-- architecture:end -->` markers. The spec relies on this diagram (§4.1: 'tables listed in the diagram'), and the v0.3 changelog item (14) explicitly claims 'architecture diagram filled' — but it is not. A reader cannot reconstruct component/data-flow topology from prose alone (which workers connect to which queues/buses, where redaction sits in the pipeline, where the per-backstory lease lives relative to the visit job lease).",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "v0.3 changelog item (14) states 'architecture diagram filled', but the §4 diagram block is the placeholder `(architecture not yet specified)`. The changelog claim is false against the current spec body.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§5.4's ship-criterion `count(ok) ≥ min_ok_visits(n)` is undefined for paired A/B mode. With N=30 paired backstories there are 60 total visits. Does `n` denote the 30 backstories or the 60 visit slots? Does `count(ok)` count individual ok visits or paired backstories where BOTH variants are ok? Paired statistics (paired-δ, paired-t, Wilcoxon, McNemar) are only computable on backstories with both visits ok, so a single-visit-ok count would let a study reach `ready` with degenerate paired output. This is a load-bearing definition for the entire ledger `partial_finalize` and finalization flow and must be specified per mode.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "§2 #6 specifies token measurement via 'Anthropic's official tokenizer library pinned by version in package.json'. Anthropic does not ship an official public client-side tokenizer library for Claude 3+/Claude 4 family models (claude-haiku-4-5 included); token counting for these models is exposed only via the API `count_tokens` endpoint (or approximated). Pinning a non-existent library in package.json is unimplementable as written, and §6.2 'truncator (pinned tokenizer)' inherits the same issue.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "HDBSCAN clustering (§2 #14, §5.7) is part of the runtime aggregator, but §1 mandates 'TypeScript end-to-end (Node 20…)' and 'Python is permitted for offline eval scripts only'. The mainstream HDBSCAN implementation is the Python `hdbscan` package; no JS-native equivalent is named, no out-of-process Python service is specified, and the cross-language boundary, determinism guarantees across that boundary, and deployment surface are all unaddressed. Either name a TS-callable HDBSCAN implementation (with its own determinism contract) or carve a runtime-Python exception with the IPC/packaging plan.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #10 sets a 120 s per-backstory lease with 15 s heartbeat and §5.11 says the lease is released 'on visit terminal commit OR on `backstory_leases.lease_until` expiry'. But a visit job's outer lease is 10 min (§2 #26) and a single LLM call plus 2 schema repairs plus 3 transient retries with 0.5→2→8 s backoff can plausibly run >120 s. If the per-backstory lease expires while variant A is still mid-call, variant B can acquire it and start in parallel — directly violating the 'no two visits for the same backstory in flight simultaneously' invariant the lease exists to enforce. Spec needs either a heartbeat-driven extension rule for the per-backstory lease, or an explicit upper bound on a single visit's wall-clock that is < 120 s, or a coordinator that re-checks lease ownership before sending the request.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #16 reports Wilcoxon signed-rank on `will_to_buy` deltas, but `will_to_buy` is an integer 0–10 (§2 #11), so paired deltas have a small support and many zero/tied differences. Wilcoxon's behavior on ties (drop zero-diff pairs? Pratt's correction? mid-rank?) and on the small sample sizes implied by `min_ok_visits(n)` (e.g., n=5 → 5 pairs) is unspecified, and the reported p-values can swing materially across these conventions. Pin the tie-handling rule and add a minimum-pairs threshold below which Wilcoxon is suppressed in favor of CI-only reporting.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.1 `paired-A/B isolation` test (a) asserts 'a backstory never appears in the OTHER variant's recorded transcript' but does not specify the matching method. Exact-substring search will trivially pass while still permitting paraphrased context bleed; semantic-similarity matching has no threshold defined; and the test as written cannot detect an LLM provider that silently caches a previous-call summary server-side. Strengthen by (i) asserting at adapter boundary that the outbound message array contains zero shared bytes with the other variant's array beyond the redacted a11y tree, (ii) asserting the adapter never sets continuation identifiers (already covered by adapter-lint, but cross-link it here), and (iii) specifying the substring/embedding threshold.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.3 5-page benchmark uses only 5 pages with κ≥0.6 (moderate agreement) as the hard ship gate, with all 5 pages from SaaS/devtools (Stripe, Linear, Supabase, PostHog, willbuy itself). User story #2 is explicitly Shopify ecommerce checkout, yet no ecommerce page is in the benchmark, so the gate provides zero evidence the tool generalizes to a primary advertised use case. Either add an ecommerce checkout page (e.g., a real Shopify store with permission) to the benchmark, or scope the v0.1 launch claim to SaaS/landing only.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 explicitly carves out semantic stability ('cluster-label ≥80% match at temperature=0; per-backstory δ within ±0.5') from CI gating and runs it nightly only. Semantic stability is the single most user-visible quality property of the product (the same backstory + same page should produce a stable verdict). Nightly-only failure means a regression can ship for ≥1 day before detection. At minimum, gate PRs on a small (e.g., 3-page × 5-backstory) sampled stability suite with the same thresholds; keep the full nightly as the broader corpus.",
      "severity": "minor"
    },
    {
      "category": "contradiction",
      "text": "User story #2 states 'Total spend ~$3 (60 visits at v0.1 cost-model defaults; see §5.6)', but §5.6's worked example computes 30 visits × 3.5¢ + 1.5¢ ≈ $1.06, ergo two runs ≈ $2.10–$2.13. The user-story figure is ~40% above the cost-model figure it cites. Either correct the story to ~$2 or correct the cost-model worked example.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #1 mandates 'an automated public-reachability probe run from an off-network checker' but never defines what 'off-network' means here. Is it a separate VPC/AS, a third-party service, a different cloud account, a Cloudflare Worker? This is a security-relevant control (proving the URL is publicly reachable, not just reachable from the requester's privileged network); without an architectural anchor it can be implemented in a way that defeats the intent.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #13 'Up to 3 attempts with jittered exponential backoff (0.5 s → 2 s → 8 s)' is ambiguous about whether 3 = total attempts (initial + 2 retries) or 3 = retries on top of the initial. The 3 backoff values listed suggest either reading. Pin the count and add it to the §6.1 retry-budget-boundary tests.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "For the v0.1 wired chat provider (claude-haiku-4-5 / Anthropic), §2 #13 / §5.6 / §6.2 don't state whether the provider's `idempotency_key` capability flag will be true or false. This determines whether `indeterminate`/reconciliation paths actually exercise in v0.1 or are dead code, and gates whether §6.2's reconciliation tests can hit a real provider failure mode vs. only a stub. State the v0.1 provider's capability flag explicitly and reference whichever Anthropic API contract supports it.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #5 lists 'DOM node count ≤ 250k' and 'total bytes downloaded ≤ 25 MB' as capture ceilings but doesn't specify enforcement mechanism (CDP heap snapshots? periodic `document.querySelectorAll('*').length` polls? response-body byte counter in the route handler?) or polling cadence. A pure post-hoc check after `networkidle` cannot prevent OOM during render; tests in §6.2 'Render-bomb' should specify what they assert about the enforcement path, not just the limit.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.1 `sampleBackstory` test 'marginals match ICP spec over N=10k within tolerance' leaves 'tolerance' undefined, so the test is unfalsifiable. Pin a chi-square or KL threshold per archetype, or assert per-bin proportions within ±2% / ±3σ of the declared distribution.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 reproducibility test claims 'sorted-input + fixed random_state guarantees float stability across CPUs' for HDBSCAN. Even with fixed seeds, libm/BLAS/SIMD differences across CPUs (and between dev macOS arm64 and prod Linux x86_64) can produce different floating-point distance computations and thus different cluster assignments at boundary points. Either run the determinism test pinned to a single architecture (and gate prod on that arch), or use a higher-level invariant (e.g., 'cluster count within ±1' / 'cluster-label set Jaccard ≥ 0.9') instead of bit-identity.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.11 sets the aggregate timeout at 3 min from `studies.created_at`, but §2 #26 gives visit jobs a 10-min lease, and the spec allows a still-leased visit past the 3-min mark to complete and route to `late_arrivals`. With paired A/B requiring both visits ok per backstory for paired stats, a slow tail of late-arriving second visits would silently shrink usable paired-N without ever appearing in the report. Spec should either (i) wait up to the visit-lease horizon before finalizing paired runs, (ii) define a separate, longer paired-aggregate timeout, or (iii) explicitly document that paired-N can be reduced by `late_arrivals` and surface that count in the report.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #25 includes 'navigation timed out > 30 s on first paint AND DOM text content < 200 chars' as a `blocked` signal, but the overall capture wall-clock is ≤ 45 s (§2 #5). The 30 s 'first paint' threshold and the 45 s wall-clock cap interact unclearly: a slow but legitimate page that paints at 35 s with rich content would breach wall-clock but not match the blocked signal — what's its terminal classification (`error`? `blocked`? credit-refund behavior)? Add the breach→classification mapping for the 30 s ≤ first-paint ≤ 45 s window.",
      "severity": "minor"
    }
  ],
  "summary": "v0.3 is materially stronger than v0.2 — target authorization, atomic spend reservation, render boundary, redaction, share-token leak controls, and per-backstory lease are all well-specified. Two structural blockers remain. (1) The architecture diagram is still an empty placeholder despite the changelog claiming it was filled — this leaves §4 substantively missing and the changelog directly contradicted. (2) `min_ok_visits(n)` is undefined for paired A/B mode (visits vs. backstories), which is load-bearing for ledger finalization and statistical validity. Two implementation-impossibility issues need correction before v0.4: an 'Anthropic official tokenizer library' that does not publicly exist (§2 #6), and HDBSCAN at runtime in a TypeScript-only stack with no named JS implementation or Python carve-out (§2 #14). The per-backstory lease can expire while a visit is mid-call (120 s lease vs. potentially longer retry budgets), reintroducing the very cross-variant overlap the lease was added to prevent. Wilcoxon tie-handling on integer 0–10 deltas is unspecified and changes reported p-values. Test-side: the 5-page benchmark omits ecommerce despite a flagship Shopify user story; the paired-isolation test doesn't specify a match method; semantic stability is nightly-only. Recommend v0.4 to fix the architecture diagram and the four major-correctness items, with the test-coverage strengthening folded in.",
  "suggested_next_version": "0.4",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
