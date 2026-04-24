# Reviewer B — Claude

## summary

v0.2 is a substantial hardening pass — sandboxing, isolation, ledger semantics, retention, and the benchmark κ gate are all welcome. The biggest remaining issues are (1) the mandatory §4 architecture diagram is still an empty placeholder, (2) the chat-provider-fallback version target contradicts itself across §2 #21, §4.1, §9, and §10, (3) the spend-cap check-then-act is racy and untested under concurrency, and (4) two real-world false-positive risks in the blocked-classifier (`__cf_bm` on normal Cloudflare pages) and default-on redactor (32+ char base64/hex is common in benign content). A handful of ambiguities — named v0.1 chat/embedding models, `min_ok_visits` formula for the full N range, what `covers` means in the ship-gate matcher, backstory-lease release semantics — should be locked down before implementation starts so that tests can be authored against concrete invariants.

## missing-requirement

- (major) §4 Architecture contains a literal placeholder `(architecture not yet specified)` inside the `architecture:begin/end` block. The mandatory architecture diagram is absent; §§4.1–4.3 describe components/boundaries/abstractions in prose but do not supply the diagram the section is reserved for. A reader cannot see the data/control-flow graph between web app → API → jobs → capture worker → visitor worker → aggregator → Postgres/object-store → Stripe/Postmark/Cloudflare at a glance.

## contradiction

- (major) The current spec is labeled v0.2, but §10 Changelog says `chat-provider fallback moved to v0.2-followup` while §§2 #21, 4.1, and 9 all say fallback `lands in v0.2`. Either the current doc is misdated or the deferral target is wrong; one of the four statements contradicts the other three. Pick one target (v0.3?) and rectify all four references.

## weak-testing

- (major) §5.5 spend-cap enforcement is a classic check-then-act race: `Before each call, worker checks today_spend + estimated_cost ≤ daily_cap`. With >1 worker calling concurrently, all can pass the check and collectively exceed the cap. §6.1 `canSpend` boundary tests (49.9% / 50.0% / 99.9% / 100.0%) are single-threaded and will not catch this. Add (a) a transactional debit-then-check under row lock (or an atomic conditional increment) in the spec, and (b) a concurrent-writer test that launches N parallel would-be debits at 99.9% of cap and asserts spend never exceeds cap.
- (major) §5.9 redaction uses `high-entropy token regex (≥ 32 chars base64/hex)` as a default-on filter before model submission. 32+ character base64/hex substrings occur in plenty of benign content on pricing/checkout pages: CSP nonces rendered into the DOM, image filenames/hashes, cache-busting query strings, content-hashed asset URLs, product SKUs, commit SHAs on changelog pages. §6.1 only asks for `golden fixtures for high-entropy tokens, JWTs, emails` — positive cases. Add explicit false-positive fixtures (asset URL with 40-char hash, 64-char nonce in script-src, SHA-256 SKU, cache-busted image URL) and assert they are NOT redacted, or tighten the rule (e.g. require sk-/xoxb-/AKIA prefix plus entropy, and scope generic high-entropy matches to obvious key/value contexts).
- (major) §6.2 paired-A/B isolation tests (b) asserts `the two calls for a backstory never share a provider-side conversation handle / session id and use different idempotency keys`. `conversation handle / session id` is a provider-side concept visible only in the adapter layer, not observable from a generic black-box test. Without fixing the adapter contract (e.g. adapter MUST NOT accept/pass any `conversation_id`/`session_id`/`previous_response_id` parameter, and MUST assert a fresh idempotency key on each call), this test becomes aspirational. Spell out the adapter-level invariants that the test asserts against, and add a static check (lint/grep) that no caller passes any conversation-continuation parameter.
- (minor) §6.2 reproducibility test: `given a fixtured set of LLM outputs, aggregator produces identical clusters`. HDBSCAN with min_cluster_size=3 on cosine distance is sensitive to floating-point ordering and ties; ensure the test pins cluster-assignment ordering by sorting strings before embedding and by running against a fixed-seed embedding fixture, or the test will flake across CPUs/libraries.

## ambiguity

- (major) §2 #22's blocked-classifier rule treats the presence of the `__cf_bm` cookie `set without page content rendering` as a blocked signal. `__cf_bm` is Cloudflare's standard bot-management cookie and is set on a very large fraction of normal Cloudflare-fronted pages, including many legitimate indie-SaaS pricing pages the product targets. Without a sharper definition of `without page content rendering` (how is non-rendering measured? DOM size floor? text-content floor? a11y-node floor?) this rule risks high false-positive rates and credit refunds on perfectly valid captures. Tighten the rule and add a dedicated false-positive CI fixture suite of Cloudflare-fronted pages that render normally.
- (major) §5.6 cost model quotes concrete cents per visit and uses them to size credit packs ($29 / $99 / $299), but the v0.1 default chat model and embedding model are never named. §2 #11 says only `a small dedicated embedding model from a provider with a public embeddings API`; §2 #21 says `one wired chat backend`. Without a named model + model version, the 3.5¢/visit estimate and the credit-pack math are unverifiable, and the §6.3 `2-min budget` ship gate depends on latency characteristics of an unnamed model. Name both models (and their pricing tiers as of the spec date) in §5.6.
- (major) §5.4 `partial_finalize` uses `min_ok_visits, default 20/30`. This is presumably 20 of 30 for default N, but the spec supports N=5..100 (§5.2). The rule for N=5 (is 4/5 the floor? 3/5? any?) and for N=100 is not given. The line between a study finishing `ready` vs `failed` — and therefore whether the operator is charged — is underspecified across the allowed N range. Replace `20/30` with a formula (e.g. `max(5, ceil(0.67·N))`) or a table.
- (major) §6.3 hard ship gate: `tool's top-3 unanswered_blockers covers ≥ 2 of the union of expert top-3 per page`. `Covers` is undefined — is it a semantic match judged by which reviewer, an exact-string match, embedding-similarity over a threshold, or LLM-judge? Given this is a ship gate, the matching procedure must be deterministic and pre-registered. Specify the matcher (e.g. third independent reviewer adjudicates `covered`/`not covered` with a pre-registered rubric) before running the benchmark.
- (minor) §6.3 third-reviewer adjudication is triggered when Cohen's κ < 0.6 between the two CRO experts, but the adjudication procedure is not specified: does the third reviewer's labels replace one of the originals, are all three averaged, or is majority rule applied per-issue? This can flip a ship-gate outcome.
- (minor) §2 #3 and §5.7 truncate a11y-tree `to ~30k tokens` greedily. The tokenizer is not named. Different providers/models have incompatible tokenizations (cl100k vs o200k vs provider-specific), so `30k tokens` is provider-dependent. Pin a tokenizer (or specify `per the chat provider's own tokenizer, measured by a dry-run counter`) and add a CI test that confirms the truncated payload never exceeds the chat provider's per-request input ceiling.
- (minor) §2 #8 output schema fields `first_impression` and `reasoning` have no length caps. Given a 5¢ per-visit cost ceiling (§5.6) and ~600 output-token budget (§5.6), an unbounded `reasoning` can push a visit over its cost ceiling and force a `cap_exceeded` failure. Add per-field max-length constraints to the JSON schema and include a fixture in `validateVisitOrRetry` tests.
- (minor) §5.1 step 4: `if the other variant's visit for this backstory is in flight, the job is requeued with backoff` — the backoff policy (constant? jittered exp?) is unspecified. With 30 backstories and concurrency 20, early overlap is the common case, so the backoff controls throughput and therefore the 2-min ship gate.
- (minor) §5.1 step 6: `3-min hard timeout` — timeout origin not stated (study-start? last visit completion? first visit start?). Ambiguous when combined with 10-min visit lease: a visit could hold a lease longer than the aggregate timeout, producing a race between aggregator and a late-returning visit writing `ok`.
- (minor) §5.1 `concurrency limit (default 20)` — the scope of this limit is unstated: per worker process, per account, or global across the fleet? This changes both throughput math against the 2-min ship gate and the interaction with the per-account/per-domain budgets in §2 #24.
- (minor) §2 #17 says `access to prod KMS limited to two named operators` — the operators are not named (or even required-to-be-named in an on-call doc). Either name them, or rephrase as a procedural requirement (e.g. `two-person access list maintained in ops runbook X`) so the ship gate is verifiable.
- (minor) §2 #7 `per-backstory lease` vs §2 #23 `10-min visibility timeout for visits`: it is unclear whether the backstory lease is a separate row (released when the visit completes) or is the visit lease itself. If it's the visit lease, then when variant A's worker dies silently, variant B must wait up to 10 min before starting, which conflicts with the 2-min ship gate. Spell out the lease hierarchy and the release trigger (commit of visit row? explicit `release_backstory_lease` call?).

## suggested-next-version

v0.3

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "missing-requirement",
      "text": "§4 Architecture contains a literal placeholder `(architecture not yet specified)` inside the `architecture:begin/end` block. The mandatory architecture diagram is absent; §§4.1–4.3 describe components/boundaries/abstractions in prose but do not supply the diagram the section is reserved for. A reader cannot see the data/control-flow graph between web app → API → jobs → capture worker → visitor worker → aggregator → Postgres/object-store → Stripe/Postmark/Cloudflare at a glance.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "The current spec is labeled v0.2, but §10 Changelog says `chat-provider fallback moved to v0.2-followup` while §§2 #21, 4.1, and 9 all say fallback `lands in v0.2`. Either the current doc is misdated or the deferral target is wrong; one of the four statements contradicts the other three. Pick one target (v0.3?) and rectify all four references.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§5.5 spend-cap enforcement is a classic check-then-act race: `Before each call, worker checks today_spend + estimated_cost ≤ daily_cap`. With >1 worker calling concurrently, all can pass the check and collectively exceed the cap. §6.1 `canSpend` boundary tests (49.9% / 50.0% / 99.9% / 100.0%) are single-threaded and will not catch this. Add (a) a transactional debit-then-check under row lock (or an atomic conditional increment) in the spec, and (b) a concurrent-writer test that launches N parallel would-be debits at 99.9% of cap and asserts spend never exceeds cap.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§2 #22's blocked-classifier rule treats the presence of the `__cf_bm` cookie `set without page content rendering` as a blocked signal. `__cf_bm` is Cloudflare's standard bot-management cookie and is set on a very large fraction of normal Cloudflare-fronted pages, including many legitimate indie-SaaS pricing pages the product targets. Without a sharper definition of `without page content rendering` (how is non-rendering measured? DOM size floor? text-content floor? a11y-node floor?) this rule risks high false-positive rates and credit refunds on perfectly valid captures. Tighten the rule and add a dedicated false-positive CI fixture suite of Cloudflare-fronted pages that render normally.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§5.9 redaction uses `high-entropy token regex (≥ 32 chars base64/hex)` as a default-on filter before model submission. 32+ character base64/hex substrings occur in plenty of benign content on pricing/checkout pages: CSP nonces rendered into the DOM, image filenames/hashes, cache-busting query strings, content-hashed asset URLs, product SKUs, commit SHAs on changelog pages. §6.1 only asks for `golden fixtures for high-entropy tokens, JWTs, emails` — positive cases. Add explicit false-positive fixtures (asset URL with 40-char hash, 64-char nonce in script-src, SHA-256 SKU, cache-busted image URL) and assert they are NOT redacted, or tighten the rule (e.g. require sk-/xoxb-/AKIA prefix plus entropy, and scope generic high-entropy matches to obvious key/value contexts).",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§5.6 cost model quotes concrete cents per visit and uses them to size credit packs ($29 / $99 / $299), but the v0.1 default chat model and embedding model are never named. §2 #11 says only `a small dedicated embedding model from a provider with a public embeddings API`; §2 #21 says `one wired chat backend`. Without a named model + model version, the 3.5¢/visit estimate and the credit-pack math are unverifiable, and the §6.3 `2-min budget` ship gate depends on latency characteristics of an unnamed model. Name both models (and their pricing tiers as of the spec date) in §5.6.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§5.4 `partial_finalize` uses `min_ok_visits, default 20/30`. This is presumably 20 of 30 for default N, but the spec supports N=5..100 (§5.2). The rule for N=5 (is 4/5 the floor? 3/5? any?) and for N=100 is not given. The line between a study finishing `ready` vs `failed` — and therefore whether the operator is charged — is underspecified across the allowed N range. Replace `20/30` with a formula (e.g. `max(5, ceil(0.67·N))`) or a table.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 paired-A/B isolation tests (b) asserts `the two calls for a backstory never share a provider-side conversation handle / session id and use different idempotency keys`. `conversation handle / session id` is a provider-side concept visible only in the adapter layer, not observable from a generic black-box test. Without fixing the adapter contract (e.g. adapter MUST NOT accept/pass any `conversation_id`/`session_id`/`previous_response_id` parameter, and MUST assert a fresh idempotency key on each call), this test becomes aspirational. Spell out the adapter-level invariants that the test asserts against, and add a static check (lint/grep) that no caller passes any conversation-continuation parameter.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§6.3 hard ship gate: `tool's top-3 unanswered_blockers covers ≥ 2 of the union of expert top-3 per page`. `Covers` is undefined — is it a semantic match judged by which reviewer, an exact-string match, embedding-similarity over a threshold, or LLM-judge? Given this is a ship gate, the matching procedure must be deterministic and pre-registered. Specify the matcher (e.g. third independent reviewer adjudicates `covered`/`not covered` with a pre-registered rubric) before running the benchmark.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§6.3 third-reviewer adjudication is triggered when Cohen's κ < 0.6 between the two CRO experts, but the adjudication procedure is not specified: does the third reviewer's labels replace one of the originals, are all three averaged, or is majority rule applied per-issue? This can flip a ship-gate outcome.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #3 and §5.7 truncate a11y-tree `to ~30k tokens` greedily. The tokenizer is not named. Different providers/models have incompatible tokenizations (cl100k vs o200k vs provider-specific), so `30k tokens` is provider-dependent. Pin a tokenizer (or specify `per the chat provider's own tokenizer, measured by a dry-run counter`) and add a CI test that confirms the truncated payload never exceeds the chat provider's per-request input ceiling.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #8 output schema fields `first_impression` and `reasoning` have no length caps. Given a 5¢ per-visit cost ceiling (§5.6) and ~600 output-token budget (§5.6), an unbounded `reasoning` can push a visit over its cost ceiling and force a `cap_exceeded` failure. Add per-field max-length constraints to the JSON schema and include a fixture in `validateVisitOrRetry` tests.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.1 step 4: `if the other variant's visit for this backstory is in flight, the job is requeued with backoff` — the backoff policy (constant? jittered exp?) is unspecified. With 30 backstories and concurrency 20, early overlap is the common case, so the backoff controls throughput and therefore the 2-min ship gate.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.1 step 6: `3-min hard timeout` — timeout origin not stated (study-start? last visit completion? first visit start?). Ambiguous when combined with 10-min visit lease: a visit could hold a lease longer than the aggregate timeout, producing a race between aggregator and a late-returning visit writing `ok`.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.1 `concurrency limit (default 20)` — the scope of this limit is unstated: per worker process, per account, or global across the fleet? This changes both throughput math against the 2-min ship gate and the interaction with the per-account/per-domain budgets in §2 #24.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #17 says `access to prod KMS limited to two named operators` — the operators are not named (or even required-to-be-named in an on-call doc). Either name them, or rephrase as a procedural requirement (e.g. `two-person access list maintained in ops runbook X`) so the ship gate is verifiable.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§6.2 reproducibility test: `given a fixtured set of LLM outputs, aggregator produces identical clusters`. HDBSCAN with min_cluster_size=3 on cosine distance is sensitive to floating-point ordering and ties; ensure the test pins cluster-assignment ordering by sorting strings before embedding and by running against a fixed-seed embedding fixture, or the test will flake across CPUs/libraries.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§2 #7 `per-backstory lease` vs §2 #23 `10-min visibility timeout for visits`: it is unclear whether the backstory lease is a separate row (released when the visit completes) or is the visit lease itself. If it's the visit lease, then when variant A's worker dies silently, variant B must wait up to 10 min before starting, which conflicts with the 2-min ship gate. Spell out the lease hierarchy and the release trigger (commit of visit row? explicit `release_backstory_lease` call?).",
      "severity": "minor"
    }
  ],
  "summary": "v0.2 is a substantial hardening pass — sandboxing, isolation, ledger semantics, retention, and the benchmark κ gate are all welcome. The biggest remaining issues are (1) the mandatory §4 architecture diagram is still an empty placeholder, (2) the chat-provider-fallback version target contradicts itself across §2 #21, §4.1, §9, and §10, (3) the spend-cap check-then-act is racy and untested under concurrency, and (4) two real-world false-positive risks in the blocked-classifier (`__cf_bm` on normal Cloudflare pages) and default-on redactor (32+ char base64/hex is common in benign content). A handful of ambiguities — named v0.1 chat/embedding models, `min_ok_visits` formula for the full N range, what `covers` means in the ship-gate matcher, backstory-lease release semantics — should be locked down before implementation starts so that tests can be authored against concrete invariants.",
  "suggested_next_version": "v0.3",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
