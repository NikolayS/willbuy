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

## Round 2 — 2026-04-24T20:04:04.935Z

- accepted missing-risk#1: Replaced the checkbox with verified-domain (DNS/well-known/meta) OR public_declared + automated probe + signed-preview/staging blocklist (§2 #1).
- accepted missing-risk#2: Added explicit no-side-effects browser policy blocking non-GETs, forms, downloads, service workers, popups, permissions, and switched to DOM-removal for banners instead of clicking (§2 #4).
- accepted weak-implementation#1: Replaced check-then-act with a single atomic conditional-increment SQL reservation before any outbound call, plus a 40-concurrent-writer CI test (§5.5, §6.1).
- accepted weak-implementation#2: Added explicit provider idempotency capability flag and `maybe_executed`/`indeterminate` state with pessimistic local debit and daily reconciliation (§2 #13, §5.4).
- accepted weak-implementation#3: Tightened egress: ≤ 50 distinct hosts, per-request DNS pinning, cross-eTLD+1 redirect re-check, HTTPS→HTTP blocked (§2 #3).
- accepted missing-risk#3: Added Cache-Control: no-store, Referrer-Policy: no-referrer, CDN cache bypass, revoke-purges-cache, and token-stripping log middleware for `/r/*` (§2 #17, §5.10, §5.12).
- accepted missing-risk#4: Added explicit render boundary: React auto-escaping, `react/no-danger` lint, markdown allow-list, strict CSP, nosniff, permissions-policy, captured URLs as code text (§5.10).
- accepted missing-risk#5: Extended retention to backups (tombstone replay), worker logs, traces, Cloudflare logs, Postmark archive, and LLM provider zero-retention endpoints (§2 #29, §5.12).
- accepted missing-risk#6: Made redaction default-on redact-before-persist AND before-submission, plus a second scrub on `/r/*` strings, with labeled-context rule to prevent benign false-positives (§2 #28, §5.9).
- accepted weak-implementation#4: Picked Firecracker microVM in v0.1 and explicitly rejected gVisor; this is no longer a week-1 spike decision (§2 #2).
- rejected unnecessary-scope#1: Authoritative project idea mandates self-hosted Supabase; removed Cloudflare is also explicit. Preview-env-per-PR is retained but hardened with secret isolation rather than dropped.
- accepted missing-risk#7: Added preview-env secret isolation: dedicated Supabase/Stripe/Postmark per PR, fork PRs receive stubs only, $5/day LLM sub-key, distinct KMS root (§2 #22).
- accepted weak-implementation#5: Added single-writer finalize with SELECT FOR UPDATE + UNIQUE(reports.study_id) + `late_arrivals` table; 3-min timeout anchored to studies.created_at (§5.11).
- accepted missing-risk#8: Added field-level logging policy: URL hashing, token stripping, encrypted `error_events` with matching TTL, weekly audit as ship gate (§5.12, §6.3).
- accepted missing-requirement#1: Filled the §4 architecture diagram with a full data/control-flow graph and trust-boundary annotations.
- accepted contradiction#1: Resolved the v0.2 vs v0.2-followup contradiction: chat-provider fallback is consistently labeled v0.3 across §§2 #24, 4.1, 9, 10.
- accepted weak-testing#1: Replaced check-then-act with atomic conditional increment and added a 40-concurrent-writer CI test at 99.9% of cap (§5.5, §6.1, §6.2).
- accepted ambiguity#1: Tightened `__cf_bm` rule — it is a block signal only combined with DOM text < 200 chars + CTA absent + 4xx/5xx; added a CF-fronted false-positive fixture suite (§2 #25, §6.1, §6.2).
- accepted weak-testing#2: Redactor scoped to labeled-context for generic high-entropy tokens; added false-positive fixtures for asset hashes, CSP nonces, SKUs, commit SHAs, cache-busted URLs (§2 #28, §6.1).
- accepted ambiguity#2: Named v0.1 chat model (claude-haiku-4-5) and embedding model (voyage-3-lite) by exact ID with price snapshot (§1, §2 #24, §5.6).
- accepted ambiguity#3: Defined `min_ok_visits(n) = max(5, ceil(0.67·n))` and enumerated values for n ∈ {5,10,20,30,50,100} (§5.4).
- accepted weak-testing#3: Wrote the adapter contract as an invariant (no conversation/session/thread/previous-response/cached-prompt identifiers) and added a grep-lint CI rule to enforce it (§2 #10, §6.1, §6.2).
- accepted ambiguity#4: Spelled out the ship-gate matcher: a blinded third-party human adjudicator with a pre-registered four-verdict rubric (exact-match / paraphrase / partial-overlap-covers / not-covered); embedding similarity is advisory only (§6.3).
- accepted ambiguity#5: Third-reviewer procedure: independent labeling, then majority rule (2-of-3) per-issue; matcher adjudicator is distinct from the three labelers (§6.3).
- accepted ambiguity#6: Pinned the chat-provider's own tokenizer (library version locked) for the 30k-token truncation and added a CI test against the provider's per-request ceiling (§2 #6).
- accepted ambiguity#7: Added per-field length caps to the output schema and `max_tokens=800` on the provider call; validator triggers schema-repair on over-cap strings (§2 #11).
- accepted ambiguity#8: Specified per-backstory-lease contention backoff: 100 ms → 400 ms → 1.6 s jittered, unlimited retries until visit-job lease expires (§5.1 step 5).
- accepted ambiguity#9: 3-min aggregate timeout is now explicitly measured from `studies.created_at`; late-arriving visits route to `late_arrivals` and do not mutate the report (§5.11).
- accepted ambiguity#10: Clarified that the default concurrency limit (20) is per-account (§2 #27).
- accepted ambiguity#11: KMS operators are a procedural requirement maintained in the ops runbook `RUN-KMS-OPERATORS.md` and reviewed quarterly (§2 #20).
- accepted weak-testing#4: HDBSCAN determinism: sort + lowercase + whitespace-normalize inputs, L2-normalize embeddings, fixed `random_state`, `approx_min_span_tree=False`, ties by sorted order (§2 #14, §5.7).
- accepted ambiguity#12: Per-backstory lease is a separate row in `backstory_leases` (NOT the visit job lease), with 120 s `lease_until` and 15 s heartbeat, released on visit terminal commit or on expiry (§2 #10, §5.11).
