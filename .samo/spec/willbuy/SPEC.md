# willbuy.dev — SPEC v0.2

## 0. Persona

Veteran "conversion research & LLM-simulated user testing" expert — someone who has shipped both CRO audit tools and LLM eval harnesses, and knows the trap in this category is producing plausible-sounding slop that doesn't correlate with reality.

## 1. Goal & why it's needed

**What this is.** willbuy.dev is a synthetic visitor panel for conversion pages — pricing, landing, and checkout. You paste one URL (or two for paired A/B), pick or author an ICP, and N independent fresh-context LLM "visitors" render the page and return a structured verdict: first impression, will-to-buy 0–10, open questions, confusions, objections, unanswered blockers, and a conversion-weighted next_action. Results aggregate into a shareable report.

**What this is NOT.** NOT a replacement for live-traffic A/B testing. NOT an analytics-calibration tool (that's v0.3). NOT a white-label agency product. NOT an enterprise/SSO/teams offering. We do NOT claim these visitors are real humans, and we do NOT try to bypass bot detection in v0.1.

**Why it's needed.** Indie hackers, early-stage SaaS founders, PMMs, and ecommerce growth operators iterate on conversion pages daily but rarely have enough live traffic for statistically-powered A/B tests. They fly blind, or pay $2–10k for a one-off CRO audit that takes weeks. A same-day synthetic panel that flags unanswered questions, surfaced objections, and pricing confusions from N diverse ICP-grounded visitors — with a paired-A/B wedge that isolates page effect from persona variance — is a sub-hour, sub-$10 feedback loop nothing else offers self-serve. CRO consultants are the secondary audience: audit-report-quality output in minutes that they re-sell.

**Technical wedge.** Paired A/B: the SAME sampled backstory visits both variants in independent fresh-context LLM sessions. Each call constructs a brand-new message array from scratch — there is no shared conversation handle, no KV-cache reuse hint, no cross-call memory. The two visits for a backstory are sequenced (per-backstory lease) so they cannot be in flight simultaneously. The pairing is a DB join over results, never an LLM-side context join. This yields paired per-backstory deltas (a within-subjects study) instead of the noisier between-subjects average — the single feature competitors cannot copy without rebuilding the orchestrator.

**Primary language / stack decision.** TypeScript end-to-end (Node 20, Next.js 14, Playwright, Supabase JS client). Supabase + Cloudflare + preview-env-per-PR + Playwright all have first-class TS support; one language lowers coordination cost for a 5-person team. Python is permitted for offline eval scripts only.

## 2. Scope (v0.1)

### In scope
1. URL capture via headless Chromium running inside a hardened sandbox (gVisor or Firecracker microVM, default-deny egress, only the target origin and its subresources reachable, no AWS/GCP/Azure metadata, no RFC1918, no link-local, no IPv6 ULA, no localhost). Accessibility-tree-rich serialization (alt text, ARIA, button labels, pricing/numeric content, reading order) plus a screenshot stored as a debug artifact. Handles SPAs, lazy-loaded images, and common cookie banners (auto-dismiss).
2. Capture resource ceilings — wall-clock ≤ 45 s, RAM ≤ 1 GB, CPU ≤ 1 vCPU, navigation depth ≤ 1 (no follow-on clicks in v0.1), DOM node count ≤ 250k, total bytes downloaded ≤ 25 MB, screenshot ≤ 5 MB after compression, a11y-tree dump ≤ 10 MB. Exceeding any limit aborts capture cleanly and records the breach.
3. Content truncation to ~30k tokens, priority: pricing sections → above-fold + primary CTAs → remaining reading order.
4. Library of 5 preset ICP archetypes: `saas_founder_pre_pmf`, `saas_founder_post_pmf`, `shopify_merchant`, `devtools_engineer`, `fintech_ops_buyer`.
5. Custom-ICP authoring form (free-text description + structured fields: stage, team size, stack, pain, entry point, budget authority).
6. Seeded, reproducible backstory sampling from ICP distribution.
7. Paired A/B: exactly 2 URLs, N paired backstories. Invariant: **no shared memory or context across the two visits for the same backstory; each call builds a new message array; pairing is a DB join over results, not cross-call LLM memory.** Enforced by a per-backstory lease — a backstory may only be in flight on one variant at a time. Max 2 URLs per study in v0.1.
8. Strict JSON-schema visitor output: `first_impression`, `will_to_buy` (0–10 int), `questions[]`, `confusions[]`, `objections[]`, `unanswered_blockers[]`, `next_action` enum, `confidence` (0–10 int), `reasoning`.
9. Validation with up to 2 schema-repair retries per visit. Each retry is a brand-new fresh-context call (new message array, no carried-over assistant turns) with the prior raw output passed as user-side data plus a repair instruction; the model never sees its own prior turn as conversation history. Schema retries are independent of transient-error retries (see #10).
10. Transient-error retry policy (provider 429/5xx/timeouts/connection resets): up to 3 attempts with jittered exponential backoff (0.5 s → 2 s → 8 s). Provider-fallback is **deferred to v0.2** — v0.1 ships with one wired chat provider behind the adapter. Visit cost cap (per-visit hard ceiling, default $0.05) caps total spend across all retries.
11. Embedding-based clustering of `objections[]` / `confusions[]` / `unanswered_blockers[]` across visitors (HDBSCAN with `min_cluster_size=3` on cosine), with LLM-generated cluster labels. Embedding provider is selected independently of the chat provider and pinned for v0.1 (default: a small dedicated embedding model from a provider with a public embeddings API). Switching the chat provider does not switch the embedding provider.
12. Conversion-weighted aggregation on `next_action`: `purchase=1.0, contact_sales=0.6, signup_free=0.15, bookmark=0.1, browse_more=0.05, leave=0.0`.
13. Paired-delta per backstory + paired statistics on `will_to_buy` (mean delta, 95% CI, paired-t **and** Wilcoxon signed-rank — both reported, since `will_to_buy` is a bounded ordinal integer and normality cannot be assumed). McNemar's on a binary collapse of `next_action` where `purchase` and `contact_sales` count as `converted=1` and all others as `converted=0` (this rule is canonical for v0.1 and explicitly named in the report; configurable thresholds are v0.2).
14. Private-by-default report URL `/r/<slug>` requiring an unguessable 22-char share token. Owner can mint additional revocable share links, set expiry (default 90 days), and explicitly toggle a public listing (still `noindex`, opt-in to indexable).
15. Two concurrent rotatable API keys per account (`sk_live_…`), each with `created_at`, `last_used_at`, optional `expires_at`, and immediate-revoke. Single-key rotation cutovers are not required.
16. Stripe Checkout for prepaid credit packs (no subscriptions in v0.1). Credit ledger in Postgres with reserve/commit/refund semantics. Idempotency keys per visit attempt; provider-billing reconciliation job runs daily.
17. Self-hosted Supabase (Postgres + storage + auth) on our infra. Postgres at-rest encryption (LUKS on the data volume); object-storage at-rest encryption with envelope encryption (data keys wrapped by a KMS-managed root key; rotation quarterly; staging/preview/prod use distinct root keys; access to prod KMS limited to two named operators).
18. Cloudflare DNS / SSL / CDN / WAF rate limits — quantified: anonymous browsing 60 RPM/IP; authenticated API 600 RPM/key; study-create 10/min/account and 100/day/account; concurrent in-flight studies per account ≤ 5.
19. Preview environment per pull request.
20. Hard daily LLM-spend cap per account with a 50%-of-cap warning email (transactional email via Postmark; magic-link auth emails remain on Supabase Auth).
21. Pluggable LLM provider — `LLMProvider` adapter interface lands in v0.1 with **one** chat backend wired. Adding the second wired backend with automatic fallback is **v0.2** (see §2 "Out of scope"). Decoupling the embedding provider from the chat provider is in v0.1.
22. Graceful bot-detection failure — capture worker classifies a capture as `blocked` when any of: HTTP 403/429/503 from the origin or an upstream CDN; response body contains a known challenge-page fingerprint (Cloudflare "Just a moment…", DataDome challenge title, PerimeterX block page, hCaptcha/Turnstile root element above-fold); navigation timed out at >30 s on first paint; or a known interstitial cookie (`__cf_bm`, `datadome`, `_px*`) is set without page content rendering. On `blocked`, surface a clear error and refund credits. Full stealth bypass is explicitly v0.2.
23. Run resumability — half-finished batches survive worker restart and continue from the last completed visit. Job queue uses leases (10-min visibility timeout for visits, 90 s for captures), worker heartbeats every 20 s, and a dead-letter table for jobs exceeding max attempts.
24. Per-account/per-target-domain concurrency budgets (default: ≤ 4 concurrent captures per target eTLD+1 per account; ≤ 8 across all accounts) and a circuit breaker that trips after 5 consecutive failures against a target domain in 5 min.
25. Data classification, redaction, and capture consent — at study creation, the user must explicitly check "I have authorization to capture this URL" and is reminded that captured content is sent to third-party model and embedding providers. Optional automatic redaction pass on captured a11y-tree before LLM submission for high-entropy strings (likely API keys, JWTs, AWS access key prefixes) and emails; redaction is on by default and may be disabled per study with explicit confirmation.
26. Data retention — debug artifacts (raw a11y-tree dumps, screenshots, full LLM transcripts) retained 30 days then deleted; report-facing aggregates retained 1 year; account deletion purges everything within 7 days; per-study "delete now" available to the owner. Public report assets (cluster labels, scores, paired deltas) never include raw transcripts or screenshots.

### Out of scope (explicitly deferred)
- **v0.2:** stealth bypass of bot detection, mobile UI, >2 URLs per study, Stripe subscriptions / billing portal / dunning, user-defined output schemas, second wired LLM provider with automatic fallback, configurable conversion-binarization thresholds, automatic PII detection beyond high-entropy + email regex.
- **v0.3:** calibration against real analytics (GA / Amplitude / PostHog).
- **Not planned:** team accounts, SSO, white-label, enterprise contracts, acting on shipped traffic, i18n, collaboration/sharing UX beyond per-link share tokens.

## 3. User stories

1. **Indie SaaS founder iterating on pricing pre-PMF.** Mira ships a $49/mo Postgres-ops tool and gets 40 visits/day — not enough to A/B. She pastes a new `pricing.example.com` + the prior variant, picks `saas_founder_pre_pmf` and `devtools_engineer`, runs N=30 paired. In 90 s she sees the new variant's top unanswered blocker is "is this self-hosted?", paired-delta will_to_buy is +1.3 (paired-t and Wilcoxon both p<0.05), and she ships a copy fix the same afternoon.
2. **Shopify merchant testing a checkout flow.** Kenji sells ergonomic keyboards. He pastes his new one-page checkout URL, picks `shopify_merchant`, N=30, single-URL. The report flags "shipping cost not visible above fold" (18/30 cluster) and "return policy unclear" (11/30). He fixes both, re-runs — clusters shrink to 3/30 and 1/30. Total spend ~$3 (60 visits across both runs at the v0.1 cost-model defaults; see §5.6).
3. **CRO consultant auditing a client's landing page.** Dana runs a boutique CRO practice. She pastes a client's enterprise-DB vendor landing page + a competitor's, picks `fintech_ops_buyer`, N=50 paired. She mints a private share link with 30-day expiry and embeds it in her deliverable. She closes the $4k audit engagement in 2 days instead of 2 weeks.
4. **Willbuy dogfooding itself (internal).** Before public launch, the team runs willbuy.dev's own pricing page with N=30 across all 5 preset ICPs. The top-3 blockers inform copy/layout fixes before Show HN.

## 4. Architecture

<!-- architecture:begin -->

```text
(architecture not yet specified)
```

<!-- architecture:end -->

### 4.1 Components
- **Web app** — Next.js 14 + Tailwind + TypeScript. Marketing, signup, dashboard, study-creation UI, report pages.
- **API server** — Node 20 + Fastify + TypeScript. REST for study create/get/list, credits, API-key auth, report data, Stripe webhook, share-token issuance/revocation.
- **Capture worker** — Node + Playwright (headless Chromium) inside a gVisor sandbox or Firecracker microVM. Default-deny egress firewall; only the target origin and its third-party subresources are reachable. Pulls capture jobs with leases; emits a11y-tree JSON + screenshot. One sandbox per capture, torn down at completion.
- **Visitor worker** — Node + TypeScript. Pulls visit jobs under a per-backstory lease, calls LLM adapter with backstory + captured page, validates JSON, runs schema-repair retries (each as a fresh call) and transient-error retries with backoff, writes visit row.
- **Aggregator worker** — Runs when a study's visits reach terminal state (or 3-min hard timeout): embedding clustering, conversion-weighted score, paired statistics, writes report.
- **LLM adapter layer** — `LLMProvider` (chat) and `EmbeddingProvider` (embeddings) interfaces. v0.1 ships 1 wired chat provider and 1 wired embedding provider; chat-provider fallback lands in v0.2. Backstory sampling, prompt assembly, retry classification, per-provider cost accounting, idempotency-key issuance live here. No vendor SDKs leak to workers.
- **Postgres (self-hosted Supabase)** — `accounts`, `api_keys`, `studies`, `page_captures`, `backstories`, `visits`, `visit_attempts`, `reports`, `share_tokens`, `credit_ledger`, `llm_spend_daily`, `jobs` (lease, heartbeat, attempts, DLQ).
- **Object storage (Supabase storage, envelope-encrypted)** — screenshots, raw a11y-tree dumps, full LLM transcripts. 30-day TTL on debug artifacts; immediate purge on study/account delete.
- **Stripe** — Checkout for credit packs; webhook to API server; credit_ledger entry in the same DB transaction, idempotent on event id.
- **Postmark** — transactional email for cap warnings, share-link notifications, account events. Magic-link auth emails remain on Supabase Auth.
- **Cloudflare** — DNS, SSL, CDN, WAF rate limits (quantified in §2 #18).

### 4.2 Key boundaries
- **Backstory isolation.** A backstory string lives in exactly one in-flight LLM context at a time, enforced by a per-backstory lease in `jobs`. Each call builds a new message array from scratch; no conversation handle, no reused system-cache key, no carried-over assistant turn. Paired A/B is a DB join over results, never cross-call LLM memory.
- **No shared state across visits.** Every visit's LLM call is independent, stateless, fresh-context. No conversation history, no cross-visitor reasoning reuse. Schema-repair retries also build a new message array — the prior raw output is passed as user-side data, not as a prior assistant turn.
- **Capture once per URL per study.** All N visitors consume the same capture snapshot, eliminating within-study drift from a live page changing mid-run.
- **Sandbox containment.** Capture workers cannot reach internal services, cloud metadata endpoints, or RFC1918 hosts. Egress is allow-listed at the network layer per-job to the target origin's resolved IPs (rebound after each DNS lookup is rejected).
- **Pluggable LLM.** Workers depend on `LLMProvider` and `EmbeddingProvider`, not on any vendor.
- **Trust surface around captured content.** Captured page text is treated as untrusted data — never executed, never used to choose a tool call, only embedded as user-role content in the visitor prompt. Redaction runs before model submission when enabled.

### 4.3 Key abstractions
- `Study { id, account_id, mode: single|paired, urls[], icp_id | custom_icp, n, seed, status, cost_cents, created_at }`
- `Backstory { id, study_id, idx, icp_id, structured_fields, rendered_text }`
- `PageCapture { id, study_id, url, a11y_tree_json, screenshot_key, captured_at, status, breach_reason? }`
- `Visit { id, study_id, backstory_id, variant_idx, capture_id, provider, model, output_json, status: pending|leased|ok|failed, terminal_reason?, latency_ms, cost_cents }`
- `VisitAttempt { id, visit_id, attempt_idx, kind: schema_repair|transient_retry|first, idempotency_key, provider_request_id, raw_output, error_class, cost_cents, started_at, ended_at }`
- `Job { id, kind: capture|visit|aggregate, ref_id, lease_until, heartbeat_at, attempts, max_attempts, dlq }`
- `Report { id, study_id, clusters_json, scores_json, paired_delta_json, default_share_token_id }`
- `ShareToken { id, report_id, token_hash, created_at, expires_at, revoked_at? }`

## 5. Implementation details

### 5.1 End-to-end data flow — paired A/B (N=30)
1. User submits `{ urls: [A, B], icp: "saas_founder_pre_pmf", n: 30, seed: 42, redact: true, capture_authorized: true }` via web app.
2. API server validates `capture_authorized=true`, validates credits ≥ estimated cost (30 backstories × 2 visits × per-visit cost from §5.6), places a credit **reserve** on the ledger, creates `Study` row + 30 `Backstory` rows (seeded sample from ICP distribution).
3. 2 capture jobs enqueued (one per URL). A capture worker leases a job (90 s visibility timeout, heartbeat every 20 s), spawns a fresh sandbox, runs headless Chromium against the target with default-deny egress except resolved target IPs, waits for network idle + lazy-load settle, auto-dismisses cookie banners, extracts a11y tree, stores screenshot + a11y JSON, flips capture status to `ok` (or `blocked` per §2 #22 → study fails, reserve refunded).
4. 60 visit jobs enqueued (30 backstories × 2 variants). Visitor workers pull jobs with concurrency limit (default 20). A visit job acquires the per-backstory lease before starting; if the other variant's visit for this backstory is in flight, the job is requeued with backoff. Each constructs a fresh-context prompt: system (visitor role + schema) + backstory + a11y tree (truncated to ~30k tokens, optionally redacted) → LLM call with structured-output / JSON-mode `response_format`. Each provider call carries an idempotency key derived from `(visit_id, attempt_idx)`.
5. Response validated against zod/JSON-schema. On schema violation, schema-repair retry (up to 2) builds a brand-new request: a new system prompt + backstory + a11y tree + a user-role block containing the prior raw output and a repair instruction. The model never sees its own prior turn as a prior assistant message. After 2 schema-repair attempts, mark visit `failed: schema`. On transient errors, transient-retry (up to 3) with jittered backoff; per-visit cost ceiling caps total attempt spend.
6. When all 60 visits reach terminal state (or 3-min hard timeout), aggregator embeds all `unanswered_blockers[]` / `objections[]` / `confusions[]` strings via the pinned embedding provider, clusters with HDBSCAN (min_cluster_size=3), LLM-labels clusters, computes conversion-weighted score per variant, paired-delta per backstory, paired-t + Wilcoxon signed-rank + McNemar's (binarization rule per §2 #13) all with 95% CI.
7. Report row written; `/r/<slug>` becomes reachable only with a valid share token; default share token issued to the owner; credit reserve **committed** for `ok` visits, **refunded** for `failed: schema` / `failed: cap_exceeded` / `failed: transient` visits, per §5.4.

### 5.2 End-to-end data flow — single URL (N default 30)
Same as §5.1 except: 1 capture job (1 URL); N visit jobs (one per backstory, single variant); aggregator skips paired-delta and McNemar's, runs clustering and conversion-weighted score on the single variant only; report renders a single-variant view. Default N is 30; minimum 5, maximum 100 in v0.1.

### 5.3 State transitions
- `Study`: `created → capturing → visiting → aggregating → ready | failed`.
- `Visit`: `pending → leased → ok | failed`. `failed` carries `terminal_reason` ∈ {`schema`, `transient`, `cap_exceeded`, `provider_error`, `lease_lost`}.
- `VisitAttempt`: `started → ended` (one row per provider call).
- `PageCapture`: `pending → leased → ok | blocked | error`.
- `Job`: `queued → leased (lease_until, heartbeat_at) → done | requeued | dlq`. A lease that misses its heartbeat past `lease_until` is reclaimable. Jobs exceeding `max_attempts` (default 5) move to DLQ for operator review.
- All transitions are row writes under `SELECT … FOR UPDATE SKIP LOCKED`. `UNIQUE(study_id, backstory_id, variant_idx)` on visits prevents duplicate rows; the per-backstory lease prevents cross-variant simultaneous execution.

### 5.4 Credit ledger semantics
- `reserve(account_id, study_id, cents)` — hold credits at study creation. Idempotent on `study_id`.
- `commit(account_id, study_id, visit_id, cents)` — finalize charge for an `ok` visit. Idempotent on `visit_id`.
- `refund(account_id, study_id, visit_id, cents, reason)` — release the reservation for a `failed` visit. Idempotent on `visit_id`.
- `partial_finalize(study_id)` — at study terminal, commit the sum over `ok` visits and refund the remainder of the reserve to the account. A study finishing `ready` (≥ `min_ok_visits`, default 20/30) keeps charges only for the actual `ok` visits; `cap_exceeded` and other-failed visits are refunded.
- `reconcile_provider_billing(date)` — daily job that pulls provider cost report and compares per-attempt cost against `visit_attempts`. Discrepancies > 1¢ create an alert; orphan provider spend (no matching attempt) is recorded in a `cost_discrepancies` table for operator action.

### 5.5 Spend cap enforcement
- Every successful LLM call debits `llm_spend_daily(account_id, date, cents)` in the same transaction that writes the `VisitAttempt` row. Idempotency key on the provider call prevents double-debit on retry storms; the daily reconciliation job catches any provider-accepted-but-not-recorded spend.
- Before each call, worker checks `today_spend + estimated_cost ≤ daily_cap`. If over cap, the visit transitions to `failed: cap_exceeded` and is refunded. Study finishes `ready` if ≥ `min_ok_visits`; otherwise `failed`, full reserve refunded.
- At 50% of cap, enqueue one warning email per account per day via Postmark.

### 5.6 Cost model (v0.1 defaults)
A per-visit cost estimator drives reservation, cap math, and credit-pack pricing. Defaults derived from the chosen v0.1 chat model and embedding model:
- Visitor call: ~6k input tokens (a11y-tree truncated) + ~600 output tokens → est. 3.5¢/visit at the v0.1 default model tier.
- Embedding call: ~30 finding strings × ~30 tokens → est. 0.05¢/visit.
- Cluster-label call: ~12 calls/study × ~300 tokens → est. 1.5¢/study amortized.
- Capture: $0 in LLM cost; sandbox runtime budget folded into infra.
- Per-visit hard ceiling: 5¢ (caps total spend across all retries).
- Reference run (User story #2): 30 single-variant visits × 3.5¢ + 1.5¢ = ~$1.06; doubled for re-run ≈ $2.10–$3 including embeddings and cluster labels.
- Credit-pack tiers: $29 (1,000 credits ≈ 285 visits), $99 (4,000 credits ≈ 1,140 visits), $299 (15,000 credits ≈ 4,280 visits). Pricing locked for v0.1; revisited after the benchmark.

### 5.7 Algorithms
- **Backstory sampling.** Each ICP archetype defines categorical distributions over `stage`, `team_size`, `stack`, `pain`, `entry_point`, `budget_authority`, plus a free-text "quirk" draw. RNG seeded by `(seed, study_id, idx)` for per-backstory reproducibility.
- **Paired-delta.** For each backstory i where both visits are `ok`: `delta_i = will_to_buy_B_i − will_to_buy_A_i`. Report mean, 95% CI, paired-t **and** Wilcoxon signed-rank p-values. Binary `next_action` collapsed per §2 #13, then McNemar's on the 2×2 discordant-pair table.
- **Conversion-weighted score.** Per variant, `score = sum(weight[next_action_i]) / n_ok`.
- **Clustering.** Embed each finding string via the pinned embedding provider; HDBSCAN with `min_cluster_size=3`; one LLM call per cluster to produce a ≤8-word label.
- **Truncation.** A11y-tree serialization ordered: pricing rows → above-fold CTAs → remaining reading order. Greedy truncate to 30k tokens.

### 5.8 Security / abuse
- API key = 32-byte random, `sk_live_` prefix, hashed in DB. Up to 2 active keys per account; immediate revoke; `last_used_at` surfaced in dashboard.
- Captures run only in server-side sandboxed workers with default-deny egress. URL validator blocks private IPv4/IPv6 ranges, localhost, link-local, AWS/GCP/Azure metadata endpoints, and guards against DNS-rebinding by snapshotting resolved IPs and rejecting rebinds at fetch time. The sandbox firewall is the second line of defense.
- Captured page text is treated as untrusted data — passed only as user-role content; never used as instructions, never used to select tool calls.
- Report URLs require a 22-char unguessable token (`nanoid`). Default `noindex`. Owner can revoke; expired tokens 410 Gone.
- Stripe webhook signature verified; event-id idempotency key on ledger writes.
- Render-bomb defenses: per-job CPU/RAM/wall/byte/DOM ceilings (§2 #2); per-account/per-domain concurrency budgets (§2 #24); circuit breaker per target domain.
- Capture-authorization checkbox surfaces legal responsibility on the user.

### 5.9 Data classification & redaction
- All captured content is classified `customer-third-party` and never used outside the requesting account.
- Redaction (default on): high-entropy token regex (≥ 32 chars base64/hex), `sk-…`/`xoxb-…`/`AKIA…` prefixes, JWT pattern, RFC5322 emails. Redacted spans replaced with `[REDACTED:kind]` before submission.
- Provider routing: chat and embedding providers are recorded per study and surfaced to the user before submission. Switching provider requires explicit account setting.

## 6. Tests plan

### 6.1 Red/green TDD — built test-first
The following modules are pure, numerical, or invariant-critical and MUST be developed test-first (RED → GREEN):
- `computePairedDelta` — known fixtures for mean, 95% CI, paired-t, Wilcoxon signed-rank, McNemar's (with the §2 #13 binarization).
- `computeConversionScore` — table-driven tests for weight map; edges (all-leave, all-purchase, single visitor).
- `sampleBackstory` — reproducibility: same seed + idx → identical backstory; distribution marginals match ICP spec within tolerance over N=10k samples.
- `validateVisitOrRetry` — fixtures for malformed outputs at every required field; schema-retry vs transient-retry classification; retry-budget boundaries; ensures schema-repair retries build a new message array (no carried-over assistant turn).
- Credit ledger (`reserve`, `commit`, `refund`, `partial_finalize`) — double-spend impossible, negative balance impossible, concurrent debits under `FOR UPDATE`, partial-finalize fixtures (e.g., 22/30 ok / 8 cap_exceeded / 0 schema-failed).
- Daily spend cap (`canSpend`) — boundaries at 49.9%, 50.0%, 99.9%, 100.0%; exactly-once 50% email per account per day.
- URL validator (SSRF guard) — IPv4 private ranges, IPv6 ULA, localhost, link-local, AWS/GCP/Azure metadata, DNS-rebinding at fetch.
- `redactCapture` — golden fixtures for high-entropy tokens, JWTs, emails; no-op when disabled; preserves a11y-tree structure.
- `classifyBlocked` — fixtures for each known bot-detection signal in §2 #22; no false positives on a slow-load fixture page.
- `JobLease` — heartbeat extends lease; missed heartbeat reclaims; max_attempts moves job to DLQ; per-backstory lease blocks concurrent variant-A and variant-B visits.

### 6.2 CI tests — written alongside implementation
- **Unit** — modules above plus a11y-tree serializer, truncator, cluster-labeler adapter, cost estimator.
- **Integration** — full URL→report loop against a fixture server (2 fake pricing pages) with a stub LLM provider returning schema-valid fixtures. Target: <30 s in CI at N=5.
- **Paired-A/B isolation tests** — (a) a backstory string never appears in the recorded transcript of the OTHER variant's call for that backstory; (b) the two calls for a backstory never share a provider-side conversation handle / session id and use different idempotency keys; (c) the prompt-assembly code path constructs a new message array from scratch per call (asserted by call counter on the assembler); (d) per-backstory lease prevents A and B from being in flight simultaneously even under contention from 50 concurrent worker threads.
- **Schema-repair freshness** — assert that on a schema-repair retry, the request to the provider contains exactly one assistant message slot (none) and the prior raw output appears only as user-role content, never as `assistant`.
- **Resume-after-restart** — start a study, kill workers mid-flight, restart, assert completion with no duplicate visits (unique constraint + lease enforced); assert lease reclaim works after `lease_until`.
- **Reproducibility (pure layers only)** — same seed → identical backstories; given a fixtured set of LLM outputs, aggregator produces identical clusters and identical paired-delta numbers across runs. **No assertion of LLM bit-identical outputs across real-provider runs.** A separate semantic-stability check (cluster-label match ≥ 80% across two real-provider runs at temperature=0; per-backstory delta within ±0.5) runs nightly, NOT in CI gating.
- **Cap enforcement** — seeded ledger at 99% of cap; next visit fails with `cap_exceeded` and is refunded; 50% email fires exactly once per day; partial-finalize correctness on a 22/30 ok run.
- **Stripe webhook** — signed test-mode webhook lands credits exactly once on retry storms (idempotency key).
- **Sandbox containment** — capture worker attempting to reach `169.254.169.254`, `127.0.0.1`, RFC1918, and a known internal hostname is rejected by the sandbox firewall; DNS-rebind attempts fail at fetch.
- **Render-bomb defenses** — fixture page exceeds DOM cap / RAM cap / byte cap; capture aborts cleanly with breach reason recorded; per-domain circuit breaker trips after 5 consecutive failures.
- **Perf regression** — automated CI run with stub-provider latencies set to realistic p50/p95 (1.2 s / 4 s/visit) at N=30 paired (60 visits) asserts ≤120 s wall-clock end-to-end; per-stage budget asserted (capture ≤ 30 s, per-visit p95 ≤ 5 s, aggregation ≤ 20 s).

### 6.3 Manual / bench tests (ship gates)
- **5-pricing-page benchmark** — Stripe, Linear, Supabase, PostHog, and willbuy.dev's own. **Two independent CRO experts** blind-flag top-3 issues per page following a published rubric (what counts as an "issue"; what counts as "covered"). Inter-rater agreement target ≥ 0.6 Cohen's κ; if below, a third reviewer adjudicates. Pass: tool's top-3 `unanswered_blockers` covers ≥ 2 of the union of expert top-3 per page, with 0 obvious false positives per page. Additionally, a hand-seeded fixture page with 3 known planted issues must surface all 3. **Hard ship gate.**
- **2-minute budget** — URL→report for N=30 paired (60 visits) at default concurrency, ≤ 120 s measured from submit to report-ready against real providers (in addition to the CI perf-regression test above). **Hard ship gate.**
- **Dogfood** — run on willbuy.dev's own pricing page before Show HN; act on top-3 blockers. **Hard ship gate.**
- **Restart-during-run drill** on staging: one successful run with workers killed mid-flight. **Hard ship gate.**
- **Sandbox red-team** — security reviewer attempts container/microVM escape and egress to internal services from inside a capture sandbox; both must fail. **Hard ship gate.**
- **Backup/restore drill** — take a Postgres + object-store backup, restore to a clean environment, verify a known study renders. **Hard ship gate.**

## 7. Team (veteran experts to hire)

- **Veteran LLM prompt engineer / eval expert (1)** — visitor prompt, ICP archetype library, output schema, retry policy, clustering, reproducibility harness, 5-page benchmark tuning.
- **Veteran conversion research / qualitative-UX expert (2, part-time ~4 weeks)** — co-author the 5 ICP archetypes, define output-schema semantic categories, and serve as the **two** independent blind human evaluators on the 5-page benchmark with a published rubric. External CRO consultants.
- **Veteran full-stack TypeScript engineer (Next.js + Postgres) (2)** — web app, API server, auth, dashboard, report page, Stripe integration. Two so frontend and API parallelize.
- **Veteran browser-automation + sandboxing engineer (Playwright + gVisor/Firecracker) (1)** — capture worker, a11y-tree extraction, SPA / lazy-load / cookie-banner handling, screenshot pipeline, sandbox containment, default-deny egress, render-bomb ceilings, bot-detection classifier.
- **Veteran DevOps engineer (self-hosted Supabase + Cloudflare + KMS) (1)** — infra bootstrap, Postgres backup/restore, preview-env-per-PR, WAF rules, KMS / envelope encryption, observability.
- **Veteran payments engineer (Stripe credits / ledger) (0.5)** — Checkout, webhook, credit ledger with reserve/commit/refund + partial-finalize + provider reconciliation, spend-cap hooks. Can be one of the TS engineers if skill overlap is real.
- **Veteran security reviewer (part-time / contract, 1 week)** — sandbox red-team, SSRF, API-key handling, webhook signature, share-token model, DoS posture. One pass before public launch.

## 8. Implementation plan (sprints)

**Sprint 0 — infra bootstrap (week 1).** Parallel:
- DevOps: self-hosted Supabase up, Cloudflare DNS/SSL, staging + prod, CI (GitHub Actions), preview-env-per-PR wiring, KMS root keys per env.
- TS engineer A: repo scaffold (pnpm monorepo), lint/format/typecheck gates, Next.js skeleton at willbuy.dev, API-server skeleton.
- LLM expert: draft visitor system prompt + output JSON schema, stub `LLMProvider` and `EmbeddingProvider` interfaces, first TDD suite (paired-delta, scoring, schema validator, redactor) RED.
- Browser-automation: sandbox PoC (gVisor or Firecracker; pick one in week 1 spike), default-deny egress firewall.

**Sprint 1 — single-URL loop (weeks 2–3).** Parallel:
- Browser-automation: capture worker inside sandbox, a11y-tree serializer, cookie-banner dismissal, screenshot storage, render-bomb ceilings, blocked-classifier. Ships when a fixture server + 5 real pricing pages capture cleanly inside the sandbox.
- LLM expert: 5 ICP archetypes, backstory sampler (reproducibility GREEN), visitor worker with schema-repair (fresh-context) and transient-retry loops (validator GREEN), one wired chat backend, one wired embedding backend.
- TS engineer A: dashboard, study-creation form (single-URL, capture-authorization checkbox, redaction toggle), study-detail page with live status, report renderer, share-token UI.
- TS engineer B: auth (email + magic link via Supabase), API-key issue/rotate (≤2 active), credit ledger reserve/commit/refund/partial_finalize (TDD GREEN), Stripe Checkout + webhook (test mode), Postmark integration.
- DevOps: observability (request logs, LLM cost per study, p50/p95 latency), KMS envelope encryption on object storage, backup/restore drill scripted.
- **Milestone:** single-URL N=30 on fixture pages end-to-end inside sandbox, ≤ 2 min, all pure tests GREEN.

**Sprint 2 — paired A/B + aggregation + abuse controls (weeks 4–5).** Parallel:
- LLM expert: aggregator (embedding, HDBSCAN, LLM cluster-label), paired-delta worker, paired-A/B orchestration with per-backstory lease and isolation tests GREEN, reproducibility-of-pure-layers GREEN, semantic-stability nightly check.
- TS engineer A: paired-A/B UI mode, report page with cluster view + paired-delta table (paired-t + Wilcoxon + McNemar), private share-link UI with revoke and expiry.
- TS engineer B: daily spend cap + 50% Postmark warning, graceful bot-detection failure + credit refund path, resume-after-restart GREEN, job lease/heartbeat/DLQ, per-account/per-domain concurrency budgets, per-domain circuit breaker, retention-deletion job (30-day debug TTL).
- Browser-automation: SPA + lazy-load hardening, blocked-classifier coverage of all §2 #22 signals.
- DevOps: Cloudflare WAF rules with quantified limits, Stripe live-mode cutover plan, restore drill GREEN.
- Security reviewer (1 week embedded): sandbox red-team, SSRF, API key, webhook, share-token model, rate-limit review + fixes.
- **Milestone:** paired A/B N=30 under 2 min, full aggregation, spend cap holds, sandbox containment GREEN, all integration tests GREEN.

**Sprint 3 — benchmark + beta (weeks 6–7).** Serial then parallel:
- Conversion experts (2 external): blind top-3-issues eval on 5 pages (willbuy.dev + Stripe, Linear, Supabase, PostHog) following published rubric; inter-rater κ ≥ 0.6. Hand-seeded fixture page check. Serial gate — must finish before ship.
- LLM expert: tune prompt / schema / clustering against benchmark misses until pass criterion holds.
- Whole team: dogfood willbuy.dev's pricing page, act on top-3 blockers, ship public landing + Show HN draft.
- Beta onboarding: invite ~20 hand-picked indie hackers / CROs; target 10 first-pack credit purchases at $29–$99 within 4 weeks post-launch (no subscriptions in v0.1).

**Ship-gate checklist for v0.1:** all CI green · 5-page benchmark passes (κ ≥ 0.6, hand-seeded fixture caught) · 2-min budget holds (CI perf test + real-provider drill) · dogfood run completed and acted on · security review sign-off including sandbox red-team · one successful restart-during-run drill on staging · backup/restore drill on staging.

## 9. Risks & mitigations (v0.1)

- **Plausible-slop risk** (visitors sound smart but don't correlate with reality) — the 5-page blind benchmark with **two** independent CRO experts and a published rubric is a **hard ship gate**.
- **Sandbox escape / SSRF via capture** — gVisor or Firecracker microVM, default-deny egress, IP-snapshot DNS-rebind defense, security red-team as ship gate.
- **Public-report data leak** — reports private-by-default behind unguessable share tokens; raw transcripts/screenshots never on the public surface; 30-day debug-artifact TTL; per-study and account-level delete.
- **LLM cost blowouts** — daily per-account cap + 50% warning + per-visit hard ceiling + provider-billing reconciliation.
- **Bot-detection on client pages** — graceful failure with explicit classifier rules + refund in v0.1; stealth bypass explicitly deferred to v0.2.
- **Provider lock-in** — `LLMProvider` and `EmbeddingProvider` adapters from day 1; chat-provider fallback wiring lands v0.2 (avoids carrying multi-provider risk through the launch benchmark).
- **Self-hosted Supabase ops burden** — DevOps hire + restore drill as ship gate. Escape hatch: switch to hosted Supabase if self-host cost/incident rate exceeds budget in Sprint 3.
- **Statistical overclaim** — paired-t **and** Wilcoxon signed-rank are reported alongside 95% CI and n_ok, never a single p-value banner; McNemar's binarization is named; any N<20 run displays a "low-power" warning.
- **Render bombs / asset floods** — per-job CPU/RAM/wall/byte/DOM caps, per-account/per-domain concurrency budgets, per-domain circuit breaker.
- **Stranded jobs after partition** — leases + heartbeats + reclaim; max_attempts → DLQ for operator review.
- **Captured PII / secrets reaching providers** — default-on redaction of high-entropy tokens / JWTs / emails; explicit per-study consent checkbox; provider routing surfaced to user; 30-day TTL on debug artifacts.

## 10. Changelog

- **v0.2 (2026-04-24)** — security and correctness pass driven by reviewer findings. Added: sandboxed capture (gVisor/Firecracker, default-deny egress, render-bomb ceilings, IP-snapshot DNS-rebind defense), private-by-default reports with revocable share tokens and 30-day debug-artifact TTL, per-backstory lease for paired-A/B isolation, fresh-context schema-repair retries (no carried-over assistant turn), separate retry classes for schema vs transient errors with per-visit cost ceiling, reserve/commit/refund/partial_finalize ledger semantics with idempotency keys per attempt and daily provider-billing reconciliation, job leases + heartbeats + DLQ, per-account/per-domain concurrency budgets and per-domain circuit breaker, 2 concurrent API keys with `last_used_at` and immediate revoke, KMS envelope encryption with env separation, data classification + default-on redaction + capture-authorization checkbox, retention policy (30-day debug, 1-year aggregates, 7-day account-delete purge), explicit bot-detection classifier rules, single-URL data-flow section, cost model + credit-pack tiers, Postmark for transactional email, quantified Cloudflare WAF limits, Wilcoxon signed-rank alongside paired-t, named McNemar binarization rule, embedding provider pinned and decoupled from chat provider. Re-scoped: chat-provider fallback moved to v0.2-followup (v0.1 ships one wired chat backend behind the adapter), automatic conversion-binarization configurability moved to v0.2. Strengthened tests: stronger isolation tests (request-id/handle/idempotency), schema-repair freshness assertion, sandbox containment test, render-bomb defense test, automated perf-regression test, two-annotator benchmark with κ ≥ 0.6 and hand-seeded fixture, sandbox red-team and backup/restore as ship gates. Filled architecture diagram. Reframed Sprint 3 commercial target as first-pack purchases (no `/mo` framing).
- **v0.1 (2026-04-24)** — initial scaffold. Scope, architecture, team, sprint plan, tests plan, and ship gates established. No prior versions.
