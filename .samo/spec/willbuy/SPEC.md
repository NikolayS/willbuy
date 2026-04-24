# willbuy.dev — SPEC v0.1

## 0. Persona

Veteran "conversion research & LLM-simulated user testing" expert — someone who has shipped both CRO audit tools and LLM eval harnesses, and knows the trap in this category is producing plausible-sounding slop that doesn't correlate with reality.

## 1. Goal & why it's needed

**What this is.** willbuy.dev is a synthetic visitor panel for conversion pages — pricing, landing, and checkout. You paste one URL (or two for paired A/B), pick or author an ICP, and N independent fresh-context LLM "visitors" render the page and return a structured verdict: first impression, will-to-buy 0–10, open questions, confusions, objections, unanswered blockers, and a conversion-weighted next_action. Results aggregate into a shareable report.

**What this is NOT.** NOT a replacement for live-traffic A/B testing. NOT an analytics-calibration tool (that's v0.3). NOT a white-label agency product. NOT an enterprise/SSO/teams offering. We do NOT claim these visitors are real humans, and we do NOT try to bypass bot detection in v0.1.

**Why it's needed.** Indie hackers, early-stage SaaS founders, PMMs, and ecommerce growth operators iterate on conversion pages daily but rarely have enough live traffic for statistically-powered A/B tests. They fly blind, or pay $2–10k for a one-off CRO audit that takes weeks. A same-day synthetic panel that flags unanswered questions, surfaced objections, and pricing confusions from N diverse ICP-grounded visitors — with a paired-A/B wedge that isolates page effect from persona variance — is a sub-hour, sub-$10 feedback loop nothing else offers self-serve. CRO consultants are the secondary audience: audit-report-quality output in minutes that they re-sell.

**Technical wedge.** Paired A/B: the SAME sampled backstory visits both variants in independent fresh-context LLM sessions, never sharing memory. This yields paired per-backstory deltas (a within-subjects study) instead of the noisier between-subjects average — the single feature competitors cannot copy without rebuilding the orchestrator.

**Primary language / stack decision.** TypeScript end-to-end (Node 20, Next.js 14, Playwright, Supabase JS client). Supabase + Cloudflare + preview-env-per-PR + Playwright all have first-class TS support; one language lowers coordination cost for a 5-person team. Python is permitted for offline eval scripts only.

## 2. Scope (v0.1)

### In scope
1. URL capture via headless Chromium — accessibility-tree-rich serialization (alt text, ARIA, button labels, pricing/numeric content, reading order) plus a screenshot stored as a debug artifact. Handles SPAs, lazy-loaded images, and common cookie banners (auto-dismiss).
2. Content truncation to ~30k tokens, priority: pricing sections → above-fold + primary CTAs → remaining reading order.
3. Library of 5 preset ICP archetypes: `saas_founder_pre_pmf`, `saas_founder_post_pmf`, `shopify_merchant`, `devtools_engineer`, `fintech_ops_buyer`.
4. Custom-ICP authoring form (free-text description + structured fields: stage, team size, stack, pain, entry point, budget authority).
5. Seeded, reproducible backstory sampling from ICP distribution.
6. Paired A/B: exactly 2 URLs, N paired backstories, each backstory visits both variants in independent fresh-context LLM sessions. Backstory string must never co-occur in both variants' contexts simultaneously. Max 2 URLs per study in v0.1.
7. Strict JSON-schema visitor output: `first_impression`, `will_to_buy` (0–10 int), `questions[]`, `confusions[]`, `objections[]`, `unanswered_blockers[]`, `next_action` enum, `confidence` (0–10 int), `reasoning`.
8. Validation with up to 2 retries per visit on schema violation; then mark `failed` (do not silently drop; counted in report).
9. Embedding-based clustering of `objections[]` / `confusions[]` / `unanswered_blockers[]` across visitors (HDBSCAN or agglomerative on cosine), with LLM-generated cluster labels.
10. Conversion-weighted aggregation on `next_action`: `purchase=1.0, contact_sales=0.6, signup_free=0.15, bookmark=0.1, browse_more=0.05, leave=0.0`.
11. Paired-delta per backstory + paired-t (on `will_to_buy`) and McNemar's (on purchase/not-purchase) with 95% CI.
12. Permanent shareable report URL `/r/<slug>` (public, `noindex` by default, opt-in indexable).
13. Single-user API-key auth (one rotatable key per account).
14. Stripe Checkout for prepaid credits (no subscriptions in v0.1). Credit ledger in Postgres.
15. Self-hosted Supabase (Postgres + storage + auth) on our infra.
16. Cloudflare DNS / SSL / CDN / basic WAF rate limits.
17. Preview environment per pull request.
18. Hard daily LLM-spend cap per account with a 50%-of-cap warning email.
19. Pluggable LLM provider from day 1 — adapter interface, ≥2 backends wired (primary + fallback).
20. Graceful bot-detection failure — if Cloudflare/DataDome/PerimeterX/etc. blocks capture, surface a clear error and refund credits. Full stealth bypass is explicitly v0.2.
21. Run resumability — half-finished batches survive server restart and continue from the last completed visit.

### Out of scope (explicitly deferred)
- **v0.2:** stealth bypass of bot detection, mobile UI, >2 URLs per study, Stripe subscriptions / billing portal / dunning, user-defined output schemas.
- **v0.3:** calibration against real analytics (GA / Amplitude / PostHog).
- **Not planned:** team accounts, SSO, white-label, enterprise contracts, acting on shipped traffic, i18n, collaboration/sharing UX beyond the public report URL.

## 3. User stories

1. **Indie SaaS founder iterating on pricing pre-PMF.** Mira ships a $49/mo Postgres-ops tool and gets 40 visits/day — not enough to A/B. She pastes a new `pricing.example.com` + the prior variant, picks `saas_founder_pre_pmf` and `devtools_engineer`, runs N=30 paired. In 90 s she sees the new variant's top unanswered blocker is "is this self-hosted?", paired-delta will_to_buy is +1.3 (p<0.05), and she ships a copy fix the same afternoon.
2. **Shopify merchant testing a checkout flow.** Kenji sells ergonomic keyboards. He pastes his new one-page checkout URL, picks `shopify_merchant`, N=30, single-URL. The report flags "shipping cost not visible above fold" (18/30 cluster) and "return policy unclear" (11/30). He fixes both, re-runs — clusters shrink to 3/30 and 1/30. Total spend ~$3.
3. **CRO consultant auditing a client's landing page.** Dana runs a boutique CRO practice. She pastes a client's enterprise-DB vendor landing page + a competitor's, picks `fintech_ops_buyer`, N=50 paired, exports the shareable report URL into her deliverable. She closes the $4k audit engagement in 2 days instead of 2 weeks.
4. **Willbuy dogfooding itself (internal).** Before public launch, the team runs willbuy.dev's own pricing page with N=30 across all 5 preset ICPs. The top-3 blockers inform copy/layout fixes before Show HN.

## 4. Architecture

<!-- architecture:begin -->

```text
(architecture not yet specified)
```

<!-- architecture:end -->

### 4.1 Components
- **Web app** — Next.js 14 + Tailwind + TypeScript. Marketing, signup, dashboard, study-creation UI, report pages.
- **API server** — Node 20 + Fastify (or Hono) + TypeScript. REST for study create/get/list, credits, API-key auth, report data, Stripe webhook.
- **Capture worker** — Node + Playwright (headless Chromium). Pulls capture jobs from a Postgres queue (`FOR UPDATE SKIP LOCKED`), emits a11y-tree JSON + screenshot. One container per capture.
- **Visitor worker** — Node + TypeScript. Pulls visit jobs, calls LLM adapter with backstory + captured page, validates JSON, retries up to 2×, writes visit row.
- **Aggregator worker** — Runs when a study's visits reach terminal state (or 3-min hard timeout): embedding clustering, conversion-weighted score, paired-delta stats, writes report.
- **LLM adapter layer** — `LLMProvider` interface; ≥2 impls wired in v0.1. Backstory sampling, prompt assembly, retry, per-provider cost accounting live here. No vendor SDKs leak to workers.
- **Postgres (self-hosted Supabase)** — `accounts`, `api_keys`, `studies`, `page_captures`, `backstories`, `visits`, `reports`, `credit_ledger`, `llm_spend_daily`.
- **Object storage (Supabase storage)** — screenshots, raw a11y-tree dumps, full LLM transcripts for debugging.
- **Stripe** — Checkout for credit packs; webhook to API server; credit_ledger entry in the same DB transaction, idempotent on event id.
- **Cloudflare** — DNS, SSL, CDN, WAF rate limits (per-IP anon, per-API-key authed).

### 4.2 Key boundaries
- **Backstory isolation.** A backstory string lives in exactly one LLM context at a time. Visitor worker accepts `(backstory_id, variant_idx)` and fetches the backstory immediately before constructing the call. Paired A/B is a DB join over results, not a cross-call LLM memory.
- **No shared state across visits.** Every visit's LLM call is independent, stateless, fresh-context. No conversation history, no cross-visitor reasoning reuse.
- **Capture once per URL per study.** All N visitors consume the same capture snapshot, eliminating within-study drift from a live page changing mid-run.
- **Pluggable LLM.** Workers depend on `LLMProvider`, not on any vendor. Per-study provider selection, account default, provider fallback on error.

### 4.3 Key abstractions
- `Study { id, account_id, mode: single|paired, urls[], icp_id | custom_icp, n, seed, status, cost_cents, created_at }`
- `Backstory { id, study_id, idx, icp_id, structured_fields, rendered_text }`
- `PageCapture { id, study_id, url, a11y_tree_json, screenshot_key, captured_at, status }`
- `Visit { id, study_id, backstory_id, variant_idx, capture_id, provider, model, output_json, status: pending|in_flight|ok|retrying|failed, retry_count, latency_ms, cost_cents }`
- `Report { id, study_id, clusters_json, scores_json, paired_delta_json, shareable_slug }`

## 5. Implementation details

### 5.1 End-to-end data flow (paired A/B, N=30)
1. User submits `{ urls: [A, B], icp: "saas_founder_pre_pmf", n: 30, seed: 42 }` via web app.
2. API server validates credits ≥ estimated cost (30 backstories × 2 visits × model price), places a credit hold, creates `Study` row + 30 `Backstory` rows (seeded sample from ICP distribution).
3. 2 capture jobs enqueued (one per URL). Capture worker runs headless Chromium, waits for network idle + lazy-load settle, auto-dismisses common cookie banners, extracts a11y tree, stores screenshot + a11y JSON, flips capture status to `ok` (or `blocked` on bot-detection → study fails, credits refunded).
4. 60 visit jobs enqueued (30 backstories × 2 variants). Visitor workers pull jobs with concurrency limit (default 20). Each constructs a fresh-context prompt: system (visitor role + schema) + backstory + a11y tree (truncated to ~30k tokens) → LLM call with structured-output / JSON-mode `response_format`.
5. Response validated against zod/JSON-schema. On violation, retry up to 2× with a "your last response did not match schema, fix it" follow-up. After 2 retries, mark visit `failed` with reason.
6. When all 60 visits reach terminal state (or 3-min hard timeout), aggregator embeds all `unanswered_blockers[]` / `objections[]` / `confusions[]` strings, clusters, LLM-labels clusters, computes conversion-weighted score per variant, paired-delta per backstory, paired-t + McNemar's with 95% CI.
7. Report row written; `/r/<slug>` goes live; credit hold finalized.

### 5.2 State transitions
- `Study`: `created → capturing → visiting → aggregating → ready | failed`.
- `Visit`: `pending → in_flight → ok | retrying → ok | failed`.
- `PageCapture`: `pending → in_flight → ok | blocked | error`.
- All transitions are row writes under `SELECT … FOR UPDATE SKIP LOCKED`. Workers may crash and restart without double-processing. Study-level resume: on worker startup, scan non-terminal studies and re-enqueue non-terminal capture/visit jobs. `UNIQUE(study_id, backstory_id, variant_idx)` on visits prevents duplicates.

### 5.3 Key algorithms
- **Backstory sampling.** Each ICP archetype defines categorical distributions over `stage`, `team_size`, `stack`, `pain`, `entry_point`, `budget_authority`, plus a free-text "quirk" draw. RNG seeded by `(seed, study_id, idx)` for per-backstory reproducibility.
- **Paired-delta.** For each backstory i where both visits are `ok`: `delta_i = will_to_buy_B_i − will_to_buy_A_i`. Report mean, 95% CI, paired-t p-value. Binary next_action compared with McNemar's on the 2×2 discordant-pair table.
- **Conversion-weighted score.** Per variant, `score = sum(weight[next_action_i]) / n_ok`.
- **Clustering.** Embed each finding string via provider's embedding endpoint; HDBSCAN with `min_cluster_size=3`; one LLM call per cluster to produce a ≤8-word label.
- **Truncation.** A11y-tree serialization ordered: pricing rows → above-fold CTAs → remaining reading order. Greedy truncate to 30k tokens.

### 5.4 Spend cap enforcement
- Every LLM call debits `llm_spend_daily(account_id, date, cents)` in the same transaction that writes the visit row.
- Before each call, worker checks `today_spend + estimated_cost ≤ daily_cap`. If over cap, visit is marked `failed: cap_exceeded`. Study finishes `ready` if ≥ `min_ok_visits` (default 20/30); otherwise `failed`, credits refunded.
- At 50% of cap, enqueue one warning email per account per day.

### 5.5 Security / abuse
- API key = 32-byte random, `sk_live_` prefix, hashed in DB.
- Captures run only in server-side workers. URL validator blocks private IPv4/IPv6 ranges, localhost, link-local, AWS/GCP metadata endpoints, and guards against DNS-rebinding at fetch time.
- Report slugs are `nanoid(16)`, `noindex` by default.
- Stripe webhook signature verified; event-id idempotency key on ledger writes.

## 6. Tests plan

### 6.1 Red/green TDD — built test-first
The following modules are pure, numerical, or invariant-critical and MUST be developed test-first (RED → GREEN):
- `computePairedDelta` — known fixtures for mean, 95% CI, paired-t, McNemar's.
- `computeConversionScore` — table-driven tests for weight map; edges (all-leave, all-purchase, single visitor).
- `sampleBackstory` — reproducibility: same seed + idx → identical backstory; distribution marginals match ICP spec within tolerance over N=10k samples.
- `validateVisitOrRetry` — fixtures for malformed outputs at every required field; retry count boundaries.
- Credit ledger (`debit`, `hold`, `refund`) — double-spend impossible, negative balance impossible, concurrent debits under `FOR UPDATE`.
- Daily spend cap (`canSpend`) — boundaries at 49.9%, 50.0%, 99.9%, 100.0%.
- URL validator (SSRF guard) — IPv4 private ranges, IPv6 ULA, localhost, link-local, AWS/GCP metadata, DNS-rebinding at fetch.

### 6.2 CI tests — written alongside implementation
- **Unit** — modules above plus a11y-tree serializer, truncator, cluster-labeler adapter.
- **Integration** — full URL→report loop against a fixture server (2 fake pricing pages) with a stub LLM provider returning schema-valid fixtures. Target: <30 s in CI at N=5.
- **Paired-A/B isolation test** — assert a backstory string never appears in the recorded transcript of the OTHER variant's call for that backstory.
- **Resume-after-restart** — start a study, kill workers mid-flight, restart, assert completion with no duplicate visits (unique constraint enforced).
- **Reproducibility** — same seed + same fixtured pages → identical per-backstory deltas across two runs.
- **Cap enforcement** — seeded ledger at 99% of cap; next visit fails with `cap_exceeded`; 50% email fires exactly once per day.
- **Stripe webhook** — signed test-mode webhook lands credits exactly once on retry storms (idempotency key).

### 6.3 Manual / bench tests (ship gates)
- **5-pricing-page benchmark** — Stripe, Linear, Supabase, PostHog, and willbuy.dev's own. External CRO expert blind-flags top-3 issues per page. Pass: tool's top-3 `unanswered_blockers` covers ≥2 of expert's top-3 per page, with 0 obvious false positives per page. **Hard ship gate.**
- **2-minute budget** — URL→report for N=30 paired (60 visits) at default concurrency, ≤120 s measured from submit to report-ready. **Hard ship gate.**
- **Dogfood** — run on willbuy.dev's own pricing page before Show HN; act on top-3 blockers. **Hard ship gate.**
- **Restart-during-run drill** on staging: one successful run. **Hard ship gate.**

## 7. Team (veteran experts to hire)

- **Veteran LLM prompt engineer / eval expert (1)** — visitor prompt, ICP archetype library, output schema, retry policy, clustering, reproducibility harness, 5-page benchmark tuning.
- **Veteran conversion research / qualitative-UX expert (1, part-time ~4 weeks)** — authors the 5 ICP archetypes, defines output-schema semantic categories, serves as blind human evaluator on the 5-page benchmark. External CRO consultant.
- **Veteran full-stack TypeScript engineer (Next.js + Postgres) (2)** — web app, API server, auth, dashboard, report page, Stripe integration. Two so frontend and API parallelize.
- **Veteran browser-automation engineer (headless Chromium / Playwright) (1)** — capture worker, a11y-tree extraction, SPA / lazy-load / cookie-banner handling, screenshot pipeline, bot-detection graceful-failure.
- **Veteran DevOps engineer (self-hosted Supabase + Cloudflare) (1)** — infra bootstrap, Postgres backup/restore, preview-env-per-PR, WAF rules, observability.
- **Veteran payments engineer (Stripe credits / ledger) (0.5)** — Checkout, webhook, credit ledger, spend-cap hooks. Can be one of the TS engineers if skill overlap is real.
- **Veteran security reviewer (part-time / contract, 1 week)** — SSRF, API-key handling, webhook signature, DoS posture. One pass before public launch.

## 8. Implementation plan (sprints)

**Sprint 0 — infra bootstrap (week 1).** Parallel:
- DevOps: self-hosted Supabase up, Cloudflare DNS/SSL, staging + prod, CI (GitHub Actions), preview-env-per-PR wiring.
- TS engineer A: repo scaffold (pnpm monorepo), lint/format/typecheck gates, Next.js skeleton at willbuy.dev, API-server skeleton.
- LLM expert: draft visitor system prompt + output JSON schema, stub `LLMProvider` interface, first TDD suite (paired-delta, scoring, schema validator) RED.

**Sprint 1 — single-URL loop (weeks 2–3).** Parallel:
- Browser-automation: capture worker, a11y-tree serializer, cookie-banner dismissal, screenshot storage. Ships when a fixture server + 5 real pricing pages capture cleanly.
- LLM expert: 5 ICP archetypes, backstory sampler (reproducibility GREEN), visitor worker with retry loop (validator GREEN), stub + 2 real `LLMProvider` backends wired.
- TS engineer A: dashboard, study-creation form (single-URL), study-detail page with live status, report renderer.
- TS engineer B: auth (email + magic link via Supabase), API-key issue/rotate, credit ledger (TDD GREEN), Stripe Checkout + webhook (test mode).
- DevOps: observability (request logs, LLM cost per study, p50/p95 latency).
- **Milestone:** single-URL N=30 on fixture pages end-to-end, ≤2 min, all pure tests GREEN.

**Sprint 2 — paired A/B + aggregation + polish (weeks 4–5).** Parallel:
- LLM expert: aggregator (embedding, HDBSCAN, LLM cluster-label), paired-delta worker, paired-A/B orchestration with isolation-test GREEN, reproducibility-under-seed GREEN.
- TS engineer A: paired-A/B UI mode, report page with cluster view + paired-delta table, shareable `/r/<slug>` public renderer.
- TS engineer B: daily spend cap + 50% warning email, graceful bot-detection failure + credit refund path, resume-after-restart GREEN.
- Browser-automation: SPA + lazy-load hardening, detection (not bypass) of bot-blockers.
- DevOps: Cloudflare WAF rules, Stripe live-mode cutover plan, backup/restore drill.
- Security reviewer (1 week embedded): SSRF, API key, webhook, rate-limit review + fixes.
- **Milestone:** paired A/B N=30 under 2 min, full aggregation, spend cap holds, all integration tests GREEN.

**Sprint 3 — benchmark + beta (weeks 6–7).** Serial then parallel:
- Conversion expert (external): blind top-3-issues eval on 5 pages (willbuy.dev + Stripe, Linear, Supabase, PostHog). Serial gate — must finish before ship.
- LLM expert: tune prompt / schema / clustering against benchmark misses until pass criterion holds.
- Whole team: dogfood willbuy.dev's pricing page, act on top-3 blockers, ship public landing + Show HN draft.
- Beta onboarding: invite ~20 hand-picked indie hackers / CROs; target 10 paid conversions at $29–99/mo within 4 weeks post-launch.

**Ship-gate checklist for v0.1:** all CI green · 5-page benchmark passes · 2-min budget holds · dogfood run completed and acted on · security review sign-off · one successful restart-during-run drill on staging.

## 9. Risks & mitigations (v0.1)

- **Plausible-slop risk** (visitors sound smart but don't correlate with reality) — the 5-page blind human-CRO benchmark is a **hard ship gate**, not a nice-to-have.
- **LLM cost blowouts** — daily per-account cap + 50% warning + account budget hold.
- **Bot-detection on client pages** — graceful failure + refund in v0.1; stealth bypass explicitly deferred to v0.2.
- **Provider lock-in** — pluggable `LLMProvider` from day 1; ≥2 backends wired.
- **Self-hosted Supabase ops burden** — DevOps hire + restore drill as ship gate. Escape hatch: switch to hosted Supabase if self-host cost/incident rate exceeds budget in Sprint 3.
- **Statistical overclaim** — paired-t and McNemar's are reported with 95% CI and n_ok, not a single p-value banner; any N<20 run displays a "low-power" warning on the report page.

## 10. Changelog

- **v0.1 (2026-04-24)** — initial scaffold. Scope, architecture, team, sprint plan, tests plan, and ship gates established. No prior versions.
