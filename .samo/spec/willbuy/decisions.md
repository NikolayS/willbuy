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

## Round 3 — 2026-04-24T21:06:28.272Z

- accepted missing-risk#1: Cut `public_declared` from v0.1 entirely; deferred to v0.2 with manual ops approval + stronger abuse-report handling. v0.1 = verified-domain only (§2 #1, User story 3 updated).
- accepted weak-implementation#1: Added explicit Capture Broker design (§2 #3, §5.13) — vsock-only one-shot typed message, host-side byte caps, iptables on tap device bound before VM boot, no reverse channel.
- accepted missing-risk#2: Added browser-stack patch/update SLO (§2 #4, §5.16): weekly cadence, 72 h CVE SLO, cosign-signed images, rollback tag, quarterly drill as ship gate.
- accepted weak-implementation#2: Tightened no-side-effects policy (§2 #7): analytics-host denylist, side-effect-path regex, query-token filter; explicitly framed as best-effort with `/r/*` caveats disclosure.
- accepted missing-risk#3: Screenshots are now opt-in only in v0.1 (§2 #32, §5.17): default off, Tesseract OCR + redactor scrub + Gaussian blur before persistence, 7-day TTL vs 30-day for a11y, never on `/r/*` or sent to LLM.
- accepted weak-implementation#3: Share token moved from path slug to query string + HttpOnly scoped cookie redirect (§2 #20, §5.12). CF query-strip on `/r/*` AND `/api/*` now covers the secret; stable non-secret slug is safe to log; revoked/expired returns 404.
- accepted weak-implementation#4: Reconciled retention (§2 #33): no backup rewrite; hot purge in 7 days; tombstone replay on any restore; explicit 21-day maximum window (14-day backup retention + 7-day hot grace) stated in the user-facing confirmation email.
- accepted weak-implementation#5: Unified provider-spend accounting into one `provider_attempts` ledger covering visit+embedding+cluster_label+probe (§2 #16, §4.3, §5.4, §5.5); atomic spend reservation and reconciliation now apply to every call kind.
- accepted weak-implementation#6: Added a prompt-caching carve-out (§1, §6.2): caching permitted ONLY on a STATIC prefix containing no variable data (no backstory, no captured content, no per-visit id); adapter test hashes the cached region across differing visits and asserts byte-identical hash. Cost model in §5.6 now cites this explicitly.
- accepted weak-implementation#7: Idempotency redesigned (§2 #15, §5.15): `logical_request_key` stable across transport retries, separate `transport_attempt_id` for observability; schema-repair increments `repair_generation` creating a new logical request (semantically a new call).
- accepted missing-risk#4: Added global backpressure (§2 #30, §5.14): global in-flight caps, per-provider token buckets at 0.8× published rate, per-provider circuit breakers, `POST /studies` 503 admission control with `Retry-After`, metrics + PagerDuty alerts.
- accepted unnecessary-scope#1: Simplified preview envs (§2 #25): per-PR Supabase + LLM sub-key + KMS root key kept (isolation that matters); Stripe and Postmark collapsed to shared sandbox with `preview_branch` metadata tagging. Reduces secret sprawl and teardown drift.
- accepted contradiction#1: Filled the architecture diagram in §4 with an ASCII topology covering all components; v0.4 changelog entry now reflects what the artifact actually contains.
- accepted missing-requirement#1: §4 now shows a full component + data-flow diagram satisfying the baseline Architecture requirement.
- accepted ambiguity#1: Added the paired-t vs Wilcoxon disagreement rule (§2 #19, §5.7): both reported side-by-side, explicit `disagreement: true` flag + 'weak — tests disagree' label when they diverge; ship-gate copy uses the conservative (larger) p-value.
- accepted weak-testing#1: Semantic-stability test given teeth (§6.2): PagerDuty + Slack alert on failure; 3 consecutive nightly failures auto-block the next production deploy via a pipeline check, overridable only by a named operator with a written incident reason. Deploy-block drill added to §6.3 ship gates.
- accepted weak-testing#2: Adjudicator role-conflict fixed (§6.3, §7): a FOURTH independent contractor is the matcher adjudicator when κ fails (and a separate blinded adjudicator when κ passes). Labelers never also serve as the coverage judge.
- accepted ambiguity#2: Fixed §5.6 cost formula dimensions: explicit per-1k-token rates (0.1¢ input, 0.5¢ output) substituted so the inline arithmetic is dimensionally correct and still equals 0.9¢.
- accepted weak-testing#3: HDBSCAN determinism claim scoped (§2 #17, §5.7): `numpy==1.26.4`, `scipy==1.11.4`, `hdbscan==0.8.33`, `sklearn==1.4.2`, OpenBLAS-serial pinned inside a container image whose SHA is pinned in the deploy manifest; `min_samples=3` + `cluster_selection_method='eom'` added. Claim explicitly narrowed to within-image reproducibility.
- accepted ambiguity#3: Curated selector list ownership defined (§5.9): `configs/banner-selectors.yaml` and `configs/overlay-selectors.yaml` owned by the browser-automation engineer via CODEOWNERS, every change requires a regression-fixture and one additional reviewer.
- accepted ambiguity#4: `primary_content_absent` and `primary_cta_absent` given operational definitions (§5.9.1): DOM text length + `role=main` subtree node count for content; a11y-tree CTA-verb regex for CTA.
- accepted weak-testing#4: Redactor boundary fixtures added (§6.1): 31-char / 33-char label-proximity, two labels at 29 and 35, newline-separated labels, multiple overlapping labels — exercises the 32-char window precisely.
- accepted weak-testing#5: Sandbox-containment integration test now covers IPv6 (§6.2): `::1`, `fe80::/10`, `fc00::/7`, IPv6-reachable cloud metadata aliases — matches the URL validator's existing coverage.
- accepted ambiguity#5: Added a pre-registered false-positive rubric to the 5-page benchmark (§6.3): a tool output is a false positive iff adjudicator labels it `not-covered` AND ≥ 2 of 3 labelers judged it as neither a real page issue nor a paraphrase of any allowed rubric issue.
- accepted weak-testing#6: Restart-during-run drill expanded to four kill points (§6.3 + §6.2): pre-lease; post-lease pre-provider-call; mid-provider-call; post-commit pre-heartbeat. Four separate staging runs required, covering distinct code paths.
- accepted ambiguity#6: Lease-contention observability added (§5.12, §6.1): per-backstory-lease retry count is a metric with a warn threshold (> 50 retries/job), alert-routed; global-in-flight depth, token-bucket fill, and circuit-breaker state also exposed.
- accepted ambiguity#7: Report surface now carries an explicit reconciliation note (§2 #19): conversion-weighted score and McNemar binarization are different quantities; users should not conflate them. Included in the report UI next to the paired-δ block.
- accepted weak-testing#7: Adapter-contract enforcement upgraded (§2 #12, §6.1): AST-based lint (`ts-morph` / `typescript-eslint`) scanning keys, properties, imports, parameter names in `packages/adapters/**`. Grep retained only as a shallow secondary check. Forbidden-key list expanded (`parent_message_id`, `context_id`, `assistant_id`, `run_id`) and maintained in `packages/adapters/forbidden-keys.ts`.
