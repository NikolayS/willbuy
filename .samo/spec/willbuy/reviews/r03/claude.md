# Reviewer B — Claude

## summary

v0.3 is substantively hardened over v0.2, but it ships with a glaring contradiction: the v0.3 changelog claims the architecture diagram is filled while §4 still contains only the '(architecture not yet specified)' placeholder — failing one of the nine mandatory baseline sections. Statistical reporting (paired-t vs Wilcoxon disagreement) and the ship-gate adjudicator role under κ-failure are underspecified in ways that touch the core 'plausible-slop' risk the spec explicitly names. Determinism claims (HDBSCAN 'float-stability across CPUs') overreach without pinning numpy/scipy/hdbscan and `min_samples`. §5.6's cost formula is dimensionally wrong even though the bottom-line number is right. Weak-testing concerns concentrate on semantic stability being nightly-only / non-gating, the adjudicator role conflict, and grep-based adapter-contract enforcement. Minor ambiguities: undefined 'curated selector list', 'no primary content rendered', 'obvious false positives', IPv6 coverage in sandbox-containment integration tests, and redactor labeled-context boundary fixtures.

## contradiction

- (major) §10 Changelog v0.3 entry (14) claims 'architecture diagram filled', but §4 still shows only the placeholder text '(architecture not yet specified)' between the architecture:begin/end markers. The diagram is absent while the changelog asserts it was added — a direct contradiction between the narrative and the artefact.

## missing-requirement

- (major) Mandatory baseline section 'Architecture' is incomplete. §4 contains components/boundaries/abstractions but the diagram block is literally '(architecture not yet specified)'. The nine-baseline requirement for an architecture section is not fully satisfied without the diagram itself; reviewers cannot see the component/data-flow topology.

## ambiguity

- (major) §2 #16 and §5.7 require reporting BOTH paired-t and Wilcoxon signed-rank, but the spec gives no decision rule or presentation rule for the case they disagree (e.g., paired-t p<0.05 but Wilcoxon p≥0.05, or vice versa). The report UI and ship-gate copy would be underspecified — does the user see both p-values side-by-side, the more conservative one, or a derived verdict? Given the 'plausible-slop' risk explicitly called out in §9, this ambiguity directly affects statistical overclaim.
- (major) §5.6 cost math 'Visitor call: ~6k input + ~600 output → est. `6 × 1¢ + 0.6 × 5¢ = ~0.9¢`' is dimensionally incorrect. 6×1 + 0.6×5 = 9, not 0.9. The final ≈0.9¢ is the right answer given $1/MTok input and $5/MTok output, but the inlined formula cannot produce it as written (the per-1k-token unit prices should be 0.1¢ and 0.5¢ respectively). A reader sanity-checking the credit-pack tiers will be confused, and anyone porting the formula to code will get a 10× error.
- (major) §2 #4 and §5.1 reference a 'curated selector list' for cookie-banner/overlay DOM removal, but the spec never defines where that list lives, how it is version-controlled, who owns updates, or how changes are reviewed. Since incorrect removal can delete primary content (affecting both capture and the 'no primary content rendered' blocked-signal in §2 #25), this is a load-bearing artefact left unspecified.
- (minor) §2 #25 blocked classifier requires 'no primary content rendered' as a conjunct of several signals, but the operational definition is missing. Is it DOM text content below a threshold? A11y tree node count? CTA absence? The absence of a crisp definition makes the classifier's behaviour and its CI fixtures non-deterministic, and the companion '20 Cloudflare-fronted pages classify ok' false-positive suite cannot be consistently authored without it.
- (minor) §6.3 ship-gate 'Pass: ≥ 2 covered per page AND 0 obvious false positives per page' uses 'obvious' without definition. 'Obvious' to whom — the adjudicator, one of the two primary reviewers, the consultant? Since this is a hard ship gate, a pre-registered rubric for 'false positive' must exist alongside the pre-registered four-verdict coverage rubric.
- (minor) §5.1 step 5 lease-contention backoff for the other variant of a backstory is '100 ms → 400 ms → 1.6 s, capped at 1.6 s, unlimited retries until its own visit-job lease expires'. With a 10-min visit-job lease, a worker could burn ~375 lease attempts before giving up. No observability contract (metric/alert) is specified for abnormal contention, and no max-retry cap is set — a bug in lease release could silently stall capacity.
- (minor) §2 #15/§2 #16: `contact_sales` carries weight 0.6 in the conversion-weighted aggregation but is collapsed to converted=1 in the McNemar binarization. The spec acknowledges 'configurable thresholds are v0.2' but does not say how this mismatch is surfaced in the report UI. A user reading will_to_buy deltas plus a McNemar result plus a weighted score may reasonably conclude they are measuring the same thing — they are not. Report-facing copy needs an explicit reconciliation note.

## weak-testing

- (major) §6.2 labels the semantic-stability test (cluster-label ≥80% match at temperature=0; per-backstory δ within ±0.5) as 'nightly, NOT CI gating'. Given §9's 'plausible-slop risk' and the fact that prompt/model drift is the single biggest quality risk in this category, silent regressions between nightly runs could ship to users undetected. No alerting, on-call routing, or deploy-block trigger is defined for a failed nightly — effectively the core quality signal has no enforcement hook.
- (major) §6.3 benchmark defines a 'separate blinded human adjudicator (not one of the two primary reviewers; a third reviewer if κ failed)'. If κ<0.6, the third reviewer both (a) labels the pages to compute majority-rule expert top-3 AND (b) serves as the coverage adjudicator. That is a role conflict: the same person defines the ground truth AND judges whether the tool's output covers it, defeating the blinding. A fourth independent adjudicator is needed in the κ-failure branch, or the roles must be separated explicitly.
- (major) §5.7 and §6.2 claim HDBSCAN determinism with 'sorted-input + fixed random_state guarantees float stability across CPUs'. This overstates reality: floating-point associativity differences across CPU SIMD widths, BLAS implementations, and numpy/scipy/hdbscan versions can produce different MST edge orderings when cosine distances are near-tied. The spec pins voyage-3-lite and claude-haiku-4-5 but does not pin numpy/scipy/hdbscan versions, HDBSCAN's `min_samples`, or `cluster_selection_method`. Reproducibility tests in §6.2 will pass on developer hardware yet silently drift in CI or production containers.
- (minor) §6.1 `redactCapture` enumerates positive and negative fixtures but does not exercise the 32-char proximity window of the labeled-context rule for generic base64/hex tokens (§2 #28). Boundary tests — label 31 chars away (should redact), label 33 chars away (should NOT), multiple overlapping labels, labels separated by newlines — are exactly where this rule is brittle, and none are called out.
- (minor) §6.2 sandbox-containment integration test lists only IPv4 examples ('169.254.169.254, 127.0.0.1, RFC1918, internal hostnames'). IPv6 loopback (::1), link-local (fe80::/10), ULA (fc00::/7), and cloud metadata endpoints reached via IPv6 are not in the integration fixture (though 6.1 URL-validator unit tests mention ULA/link-local). A capture worker running dual-stack could egress via IPv6 to equivalents not covered by the integration gate.
- (minor) §6.3 'Restart-during-run drill on staging: one successful run with workers killed mid-flight' — a single trial is a very thin sample for a resumability gate. Killing the worker at different points in the visit-job lifecycle (pre-lease, post-lease/pre-provider-call, mid-provider-call, post-commit/pre-heartbeat) exercises distinct code paths; one drill likely covers only one of them.
- (minor) §2 #10 adapter-contract lint is 'a CI lint rule greps the repo for these identifiers at adapter call sites'. Grep-based lint misses aliased imports, computed property names, spread objects, and provider-specific synonyms not listed (e.g., `parent_message_id`, `context_id`, future provider IDs). An AST-based lint with a typed negative list on the `LLMProvider.complete` parameter shape would be materially stronger, and the current test does not guarantee the invariant it is claimed to.

## suggested-next-version

v0.4

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "contradiction",
      "text": "§10 Changelog v0.3 entry (14) claims 'architecture diagram filled', but §4 still shows only the placeholder text '(architecture not yet specified)' between the architecture:begin/end markers. The diagram is absent while the changelog asserts it was added — a direct contradiction between the narrative and the artefact.",
      "severity": "major"
    },
    {
      "category": "missing-requirement",
      "text": "Mandatory baseline section 'Architecture' is incomplete. §4 contains components/boundaries/abstractions but the diagram block is literally '(architecture not yet specified)'. The nine-baseline requirement for an architecture section is not fully satisfied without the diagram itself; reviewers cannot see the component/data-flow topology.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #16 and §5.7 require reporting BOTH paired-t and Wilcoxon signed-rank, but the spec gives no decision rule or presentation rule for the case they disagree (e.g., paired-t p<0.05 but Wilcoxon p≥0.05, or vice versa). The report UI and ship-gate copy would be underspecified — does the user see both p-values side-by-side, the more conservative one, or a derived verdict? Given the 'plausible-slop' risk explicitly called out in §9, this ambiguity directly affects statistical overclaim.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 labels the semantic-stability test (cluster-label ≥80% match at temperature=0; per-backstory δ within ±0.5) as 'nightly, NOT CI gating'. Given §9's 'plausible-slop risk' and the fact that prompt/model drift is the single biggest quality risk in this category, silent regressions between nightly runs could ship to users undetected. No alerting, on-call routing, or deploy-block trigger is defined for a failed nightly — effectively the core quality signal has no enforcement hook.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.3 benchmark defines a 'separate blinded human adjudicator (not one of the two primary reviewers; a third reviewer if κ failed)'. If κ<0.6, the third reviewer both (a) labels the pages to compute majority-rule expert top-3 AND (b) serves as the coverage adjudicator. That is a role conflict: the same person defines the ground truth AND judges whether the tool's output covers it, defeating the blinding. A fourth independent adjudicator is needed in the κ-failure branch, or the roles must be separated explicitly.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§5.6 cost math 'Visitor call: ~6k input + ~600 output → est. `6 × 1¢ + 0.6 × 5¢ = ~0.9¢`' is dimensionally incorrect. 6×1 + 0.6×5 = 9, not 0.9. The final ≈0.9¢ is the right answer given $1/MTok input and $5/MTok output, but the inlined formula cannot produce it as written (the per-1k-token unit prices should be 0.1¢ and 0.5¢ respectively). A reader sanity-checking the credit-pack tiers will be confused, and anyone porting the formula to code will get a 10× error.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§5.7 and §6.2 claim HDBSCAN determinism with 'sorted-input + fixed random_state guarantees float stability across CPUs'. This overstates reality: floating-point associativity differences across CPU SIMD widths, BLAS implementations, and numpy/scipy/hdbscan versions can produce different MST edge orderings when cosine distances are near-tied. The spec pins voyage-3-lite and claude-haiku-4-5 but does not pin numpy/scipy/hdbscan versions, HDBSCAN's `min_samples`, or `cluster_selection_method`. Reproducibility tests in §6.2 will pass on developer hardware yet silently drift in CI or production containers.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #4 and §5.1 reference a 'curated selector list' for cookie-banner/overlay DOM removal, but the spec never defines where that list lives, how it is version-controlled, who owns updates, or how changes are reviewed. Since incorrect removal can delete primary content (affecting both capture and the 'no primary content rendered' blocked-signal in §2 #25), this is a load-bearing artefact left unspecified.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #25 blocked classifier requires 'no primary content rendered' as a conjunct of several signals, but the operational definition is missing. Is it DOM text content below a threshold? A11y tree node count? CTA absence? The absence of a crisp definition makes the classifier's behaviour and its CI fixtures non-deterministic, and the companion '20 Cloudflare-fronted pages classify ok' false-positive suite cannot be consistently authored without it.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.1 `redactCapture` enumerates positive and negative fixtures but does not exercise the 32-char proximity window of the labeled-context rule for generic base64/hex tokens (§2 #28). Boundary tests — label 31 chars away (should redact), label 33 chars away (should NOT), multiple overlapping labels, labels separated by newlines — are exactly where this rule is brittle, and none are called out.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 sandbox-containment integration test lists only IPv4 examples ('169.254.169.254, 127.0.0.1, RFC1918, internal hostnames'). IPv6 loopback (::1), link-local (fe80::/10), ULA (fc00::/7), and cloud metadata endpoints reached via IPv6 are not in the integration fixture (though 6.1 URL-validator unit tests mention ULA/link-local). A capture worker running dual-stack could egress via IPv6 to equivalents not covered by the integration gate.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§6.3 ship-gate 'Pass: ≥ 2 covered per page AND 0 obvious false positives per page' uses 'obvious' without definition. 'Obvious' to whom — the adjudicator, one of the two primary reviewers, the consultant? Since this is a hard ship gate, a pre-registered rubric for 'false positive' must exist alongside the pre-registered four-verdict coverage rubric.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.3 'Restart-during-run drill on staging: one successful run with workers killed mid-flight' — a single trial is a very thin sample for a resumability gate. Killing the worker at different points in the visit-job lifecycle (pre-lease, post-lease/pre-provider-call, mid-provider-call, post-commit/pre-heartbeat) exercises distinct code paths; one drill likely covers only one of them.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.1 step 5 lease-contention backoff for the other variant of a backstory is '100 ms → 400 ms → 1.6 s, capped at 1.6 s, unlimited retries until its own visit-job lease expires'. With a 10-min visit-job lease, a worker could burn ~375 lease attempts before giving up. No observability contract (metric/alert) is specified for abnormal contention, and no max-retry cap is set — a bug in lease release could silently stall capacity.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #15/§2 #16: `contact_sales` carries weight 0.6 in the conversion-weighted aggregation but is collapsed to converted=1 in the McNemar binarization. The spec acknowledges 'configurable thresholds are v0.2' but does not say how this mismatch is surfaced in the report UI. A user reading will_to_buy deltas plus a McNemar result plus a weighted score may reasonably conclude they are measuring the same thing — they are not. Report-facing copy needs an explicit reconciliation note.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§2 #10 adapter-contract lint is 'a CI lint rule greps the repo for these identifiers at adapter call sites'. Grep-based lint misses aliased imports, computed property names, spread objects, and provider-specific synonyms not listed (e.g., `parent_message_id`, `context_id`, future provider IDs). An AST-based lint with a typed negative list on the `LLMProvider.complete` parameter shape would be materially stronger, and the current test does not guarantee the invariant it is claimed to.",
      "severity": "minor"
    }
  ],
  "summary": "v0.3 is substantively hardened over v0.2, but it ships with a glaring contradiction: the v0.3 changelog claims the architecture diagram is filled while §4 still contains only the '(architecture not yet specified)' placeholder — failing one of the nine mandatory baseline sections. Statistical reporting (paired-t vs Wilcoxon disagreement) and the ship-gate adjudicator role under κ-failure are underspecified in ways that touch the core 'plausible-slop' risk the spec explicitly names. Determinism claims (HDBSCAN 'float-stability across CPUs') overreach without pinning numpy/scipy/hdbscan and `min_samples`. §5.6's cost formula is dimensionally wrong even though the bottom-line number is right. Weak-testing concerns concentrate on semantic stability being nightly-only / non-gating, the adjudicator role conflict, and grep-based adapter-contract enforcement. Minor ambiguities: undefined 'curated selector list', 'no primary content rendered', 'obvious false positives', IPv6 coverage in sandbox-containment integration tests, and redactor labeled-context boundary fixtures.",
  "suggested_next_version": "v0.4",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
