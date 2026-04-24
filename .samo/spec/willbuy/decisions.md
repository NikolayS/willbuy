# decisions

- No review-loop decisions yet.

## Round 1 — 2026-04-24T19:15:05.692Z

- accepted missing-risk#1: Added gVisor/Firecracker sandbox with default-deny egress, IP-snapshot DNS-rebind defense, and explicit metadata-endpoint blocks; sandbox red-team is now a ship gate.
- accepted missing-risk#2: Reports are now private-by-default behind unguessable share tokens with revoke and 90-day default expiry; debug artifacts have a 30-day TTL and are excluded from the public surface.
- accepted weak-implementation#1: Schema-repair retries explicitly build a brand-new message array with the prior raw output passed only as user-role data; a CI test asserts no assistant-role carryover.
- accepted weak-implementation#2: Per-backstory lease in jobs table prevents simultaneous A and B execution; explicit isolation test asserts the invariant under contention.
- accepted weak-implementation#3: Replaced same-transaction claim with reserve/commit/refund/partial_finalize semantics, idempotency keys per visit attempt, and a daily provider-billing reconciliation job.
- accepted missing-risk#3: Added data classification, default-on redaction of high-entropy tokens/JWTs/emails, capture-authorization checkbox, and explicit provider-routing visibility.
- accepted weak-implementation#4: Job model now includes leases with visibility timeouts, heartbeats, attempt counts, and a dead-letter queue; resume-after-restart and lease-reclaim covered by tests.
- accepted missing-risk#4: Added per-job resource ceilings (wall, RAM, CPU, DOM, bytes, screenshot/dump sizes), per-account/per-domain concurrency budgets, and per-domain circuit breaker.
- accepted unnecessary-scope#1: Multi-provider chat fallback re-scoped to v0.2 (adapter still ships in v0.1 with one wired backend); other surfaces retained because dropping them would force rework before benchmark, but trust surface is reduced via private reports + sandbox + reconciliation.
- accepted missing-risk#5: Two concurrent API keys with last_used_at metadata, optional expires_at, and immediate revoke replace the single-key cutover model.
- accepted missing-risk#6: Added envelope encryption with KMS-managed root keys, quarterly rotation, env separation (preview/staging/prod), and named two-operator access boundary.
- accepted missing-requirement#1: Architecture diagram filled with a complete component/data-flow ASCII diagram covering Cloudflare, web, API, Postgres, three workers, sandbox boundary, providers, Stripe, and Postmark.
- accepted contradiction#1: Sprint 3 target reframed as first-pack credit purchases at $29–$99, removing the /mo framing that contradicted the no-subscriptions scope decision.
- accepted ambiguity#1: Paired-A/B invariant rewritten in §2 #7 and §6.2 to state the actual rule: no shared memory/context across the two visits for the same backstory; pairing is a DB join, not cross-call LLM memory.
- accepted weak-testing#1: CI reproducibility test scoped to pure layers (sampler, validator, aggregator on fixtured outputs); a separate nightly semantic-stability check (delta ±0.5, label match ≥80%) runs against real providers but does not gate CI.
- accepted ambiguity#2: Embedding provider is now a separate `EmbeddingProvider` adapter, pinned for v0.1 and explicitly decoupled from chat-provider selection.
- accepted ambiguity#3: Canonical McNemar binarization rule named (purchase + contact_sales = converted); Wilcoxon signed-rank added alongside paired-t to handle the bounded-ordinal nature of will_to_buy.
- accepted ambiguity#4: Retry policy split into two classes — schema-repair (≤2, fresh-context) and transient (≤3, jittered backoff) — with a per-visit cost ceiling and distinct terminal_reason values; provider fallback explicitly v0.2.
- accepted weak-testing#2: Benchmark now requires two independent CRO experts with a published rubric, Cohen's κ ≥ 0.6, third-reviewer adjudication on disagreement, and a hand-seeded fixture page with planted issues.
- accepted weak-testing#3: Isolation tests strengthened: assert distinct provider request ids, no shared conversation handle, distinct idempotency keys, fresh message-array construction (assembler call counter), and lease-blocked concurrent execution.
- accepted ambiguity#5: Bot-detection classifier rules enumerated in §2 #22 (HTTP 403/429/503, challenge-page fingerprints, interstitial cookies, navigation timeouts) and covered by `classifyBlocked` TDD.
- accepted ambiguity#6: §5.4 partial_finalize now spells out: cap_exceeded visits are refunded; ready outcomes commit only ok visits and refund the remainder of the reserve; partial-finalize fixtures added to ledger TDD.
- accepted weak-testing#4: Added an automated CI perf-regression test against a stub provider with realistic latencies plus per-stage budgets (capture ≤30s, per-visit p95 ≤5s, aggregation ≤20s) alongside the manual real-provider drill.
- accepted missing-requirement#2: Retention policy added: debug artifacts 30 days, aggregates 1 year, account-delete purge within 7 days, per-study delete-now; public report assets exclude raw transcripts and screenshots.
- accepted ambiguity#7: Two concurrent API keys per account replace the single-key cutover model, eliminating the rotation-breakage trade-off.
- accepted missing-requirement#3: Cost model in §5.6 ties per-visit/embedding/cluster-label costs to a per-visit ceiling and credit-pack tiers, supporting both reservation math and the $3 figure in user story #2.
- accepted missing-requirement#4: Postmark named as the transactional email backend for cap warnings and product notifications; Supabase Auth retained for magic-link auth emails only; Sprint 1 assigns the integration to TS engineer B.
- accepted ambiguity#8: Cloudflare WAF limits quantified in §2 #18: 60 RPM/IP anon, 600 RPM/key, study-create 10/min and 100/day per account, ≤5 concurrent studies per account.
- accepted ambiguity#9: Added §5.2 single-URL data flow as a sibling section, explicitly stating capture count, default N (30, range 5–100), and which aggregation steps are skipped (paired-delta, McNemar).
