# willbuy.dev — SPEC v0.3

## 0. Persona

Veteran "conversion research & LLM-simulated user testing" expert — someone who has shipped both CRO audit tools and LLM eval harnesses, and knows the trap in this category is producing plausible-sounding slop that doesn't correlate with reality.

## 1. Goal & why it's needed

**What this is.** willbuy.dev is a synthetic visitor panel for conversion pages — pricing, landing, and checkout. You paste one URL (or two for paired A/B), pick or author an ICP, and N independent fresh-context LLM "visitors" render the page and return a structured verdict: first impression, will-to-buy 0–10, open questions, confusions, objections, unanswered blockers, and a conversion-weighted next_action. Results aggregate into a shareable report.

**What this is NOT.** NOT a replacement for live-traffic A/B testing. NOT an analytics-calibration tool (that's v0.3+). NOT a white-label agency product. NOT an enterprise/SSO/teams offering. We do NOT claim these visitors are real humans, and we do NOT try to bypass bot detection in v0.1.

**Why it's needed.** Indie hackers, early-stage SaaS founders, PMMs, and ecommerce growth operators iterate on conversion pages daily but rarely have enough live traffic for statistically-powered A/B tests. They fly blind, or pay $2–10k for a one-off CRO audit that takes weeks. A same-day synthetic panel that flags unanswered questions, surfaced objections, and pricing confusions from N diverse ICP-grounded visitors — with a paired-A/B wedge that isolates page effect from persona variance — is a sub-hour, sub-$10 feedback loop nothing else offers self-serve. CRO consultants are the secondary audience: audit-report-quality output in minutes that they re-sell.

**Technical wedge.** Paired A/B: the SAME sampled backstory visits both variants in independent fresh-context LLM sessions. Each call constructs a brand-new message array from scratch — there is no shared conversation handle, no KV-cache reuse hint, no cross-call memory, no provider-side `conversation_id` / `session_id` / `thread_id` / `previous_response_id` / `cached_prompt_id`. The two visits for a backstory are sequenced (per-backstory lease) so they cannot be in flight simultaneously. The pairing is a DB join over results, never an LLM-side context join. This yields paired per-backstory deltas (a within-subjects study) instead of the noisier between-subjects average — the single feature competitors cannot copy without rebuilding the orchestrator.

**Primary language / stack decision.** TypeScript end-to-end (Node 20, Next.js 14, Playwright, Supabase JS client). Supabase + Cloudflare + preview-env-per-PR + Playwright all have first-class TS support; one language lowers coordination cost for a 5-person team. Python is permitted for offline eval scripts only. v0.1 chat model is **`claude-haiku-4-5`** (pinned by exact ID); v0.1 embedding model is **`voyage-3-lite`** (pinned by exact ID). Model upgrades go through a versioned adapter bump and re-run the semantic-stability suite before promotion.

## 2. Scope (v0.1)

### In scope
1. **Target authorization — verified-domain OR public-declared with automated probe.** Capture is permitted only against a URL whose eTLD+1 is in `account.verified_domains` (proven via TXT DNS record `willbuy-verify=<token>`, a `/.well-known/willbuy-verify` file, or an HTML meta tag on the root — any one suffices), OR a URL the user submits with `authorization_mode: "public_declared"` that passes an automated public-reachability probe run from an off-network checker (no cookies, no referer, HTTP 200, `robots.txt` not `Disallow: /`, no auth-wall fingerprint) AND is not on a blocklist of signed-preview providers (`*.vercel.app` preview branches, `*.netlify.app` preview branches, `*.pages.dev` preview branches, `*.ngrok.*`, `*.trycloudflare.com`, `*.lndo.site`, `*.localhost.run`) or staging subdomain patterns (`staging.*`, `stage.*`, `preview.*`, `dev.*`, `uat.*`, `test.*`). A plain checkbox is NOT the control. Attempts failing these checks are rejected with a clear message before any credit reserve.
2. URL capture via **headless Chromium running inside a Firecracker microVM** (chosen in v0.1; gVisor explicitly rejected — its syscall interposition is a weaker isolation boundary than a KVM-backed microVM for running untrusted JS from arbitrary third-party pages). Per-capture fresh microVM torn down at completion. Default-deny egress: only the initial target origin and an explicit list of its third-party subresource hosts are reachable; no AWS/GCP/Azure/Oracle/DO metadata endpoints, no RFC1918, no link-local, no IPv6 ULA, no localhost.
3. **Egress policy (quantified).** ≤ 50 distinct egress hosts per capture; cross-eTLD+1 redirects from the initial navigation are re-checked against the blocklist and the new eTLD+1 counts against the host budget; HTTP→HTTPS upgrade allowed, HTTPS→HTTP blocked; per-request DNS pinning (DNS resolved once per host at capture start, IPs snapshotted, rebinds at fetch time rejected); subresource requests to any unresolved or policy-rejected host drop silently (no retry loop); capture fails if any resolved IP lands in a private/metadata range even post-resolution.
4. **No-side-effects browser policy.** During capture, Playwright is configured to: abort all non-GET navigations and XHR (POST/PUT/PATCH/DELETE/CONNECT); block form submits; block file downloads; disable service-worker registration; deny all permissions via `context.grantPermissions([])` (notifications, geolocation, camera/mic, clipboard, MIDI); block popups / `window.open`; abort WebSocket opens after first `networkidle`; block `navigator.sendBeacon`. Cookie banners are dismissed by **DOM-removal of a curated selector list**, NOT by clicking — clicking a "Reject all" button can fire tracking beacons or consent POSTs. Fullscreen overlays matching the curated selector list are removed; unknown overlays are left in place and flagged on the report.
5. Capture resource ceilings — wall-clock ≤ 45 s, RAM ≤ 1 GB, CPU ≤ 1 vCPU, navigation depth ≤ 1 (no follow-on clicks in v0.1), DOM node count ≤ 250k, total bytes downloaded ≤ 25 MB, screenshot ≤ 5 MB after compression, a11y-tree dump ≤ 10 MB, ≤ 50 distinct egress hosts. Exceeding any limit aborts capture cleanly and records the breach reason.
6. **Content truncation to 30k tokens with pinned tokenizer.** Tokens are measured by the chat provider's own tokenizer (v0.1: Anthropic's official tokenizer library pinned by version in `package.json`). Priority: pricing sections → above-fold + primary CTAs → remaining reading order. A CI test asserts truncated payloads never exceed the provider's per-request input ceiling.
7. Library of 5 preset ICP archetypes: `saas_founder_pre_pmf`, `saas_founder_post_pmf`, `shopify_merchant`, `devtools_engineer`, `fintech_ops_buyer`.
8. Custom-ICP authoring form (free-text description + structured fields: stage, team size, stack, pain, entry point, budget authority).
9. Seeded, reproducible backstory sampling from ICP distribution.
10. **Paired A/B** — exactly 2 URLs, N paired backstories. Invariant: **no shared memory or context across the two visits for the same backstory; each call builds a new message array; pairing is a DB join over results, not cross-call LLM memory.** Enforced by a separate per-backstory lease row in `backstory_leases(backstory_id, holder_visit_id, lease_until, heartbeat_at)` — distinct from the visit job lease — with `lease_until` = 120 s from acquisition and heartbeat every 15 s, released on the visit row committing to terminal state OR on lease expiry. Max 2 URLs per study in v0.1. **Adapter contract:** `LLMProvider.complete(…)` MUST NOT accept any parameter named `conversation_id`, `session_id`, `thread_id`, `previous_response_id`, `cached_prompt_id`, or any provider-specific equivalent. A CI lint rule greps the repo for these identifiers at adapter call sites.
11. **Strict JSON-schema visitor output with per-field length caps.** `first_impression` (string, ≤ 400 chars), `will_to_buy` (int 0–10), `questions[]` (≤ 10 items, each ≤ 200 chars), `confusions[]` (≤ 10 × ≤ 200 chars), `objections[]` (≤ 10 × ≤ 200 chars), `unanswered_blockers[]` (≤ 10 × ≤ 200 chars), `next_action` (enum), `confidence` (int 0–10), `reasoning` (string, ≤ 1200 chars). Provider call sets `max_tokens=800`. Validator rejects over-cap strings and triggers a schema-repair retry.
12. Validation with up to 2 schema-repair retries per visit. Each retry is a brand-new fresh-context call (new message array, no carried-over assistant turns) with the prior raw output passed as user-role data plus a repair instruction; the model never sees its own prior turn as conversation history. Schema retries are independent of transient-error retries (#13).
13. **Transient-error retry + provider-idempotency contract.** Up to 3 attempts with jittered exponential backoff (0.5 s → 2 s → 8 s) for 429/5xx/timeouts/connection resets. The adapter emits a deterministic idempotency key per `(visit_id, attempt_idx)`; the `LLMProvider` interface declares (via typed capability flag) whether the provider honors idempotency for the request kind. **If it does not, any `timeout` / `connection_reset` / `unknown_status` is classified `maybe_executed`:** local spend is pessimistically debited at the per-visit hard ceiling, the attempt is marked `indeterminate`, and it is NOT retried automatically within the same visit; the daily reconciliation job resolves indeterminate attempts against provider billing and either refunds or commits. Provider-fallback is **v0.3** — v0.1 ships one wired chat provider behind the adapter. Per-visit cost cap (default 5¢) caps total spend across all retries.
14. **Embedding clustering** on `objections[]` / `confusions[]` / `unanswered_blockers[]` across visitors (HDBSCAN with `min_cluster_size=3` on cosine distance). Determinism: input strings are lowercased and whitespace-normalized, sorted lexicographically before embedding; embedding vectors are L2-normalized; HDBSCAN invoked with a fixed `random_state`, `approx_min_span_tree=False`, and ties resolved by the sorted input order. Embedding provider (`voyage-3-lite`) is pinned and selected independently of the chat provider.
15. Conversion-weighted aggregation on `next_action`: `purchase=1.0, contact_sales=0.6, signup_free=0.15, bookmark=0.1, browse_more=0.05, leave=0.0`.
16. Paired-delta per backstory + paired statistics on `will_to_buy` (mean delta, 95% CI, paired-t **and** Wilcoxon signed-rank — both reported). McNemar's on a binary collapse of `next_action` where `purchase` and `contact_sales` count as `converted=1` and all others as `converted=0` (canonical v0.1 rule, configurable thresholds are v0.2).
17. **Private-by-default report URL** `/r/<slug>` requiring an unguessable 22-char share token. Every token-bearing response sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, strict CSP (see §5.10), and is excluded from server-side analytics/error-reporting pipelines by middleware that strips tokens from any outbound log event. Cloudflare cache is explicitly bypassed for `/r/*` via page rule; on revoke or expiry the route returns 410 Gone and a cache purge is issued to Cloudflare for the token path. Owner can mint additional revocable share links, set expiry (default 90 days), and explicitly toggle a public listing (still `noindex`; opt-in to indexable).
18. Two concurrent rotatable API keys per account (`sk_live_…`), each with `created_at`, `last_used_at`, optional `expires_at`, immediate revoke.
19. Stripe Checkout for prepaid credit packs (no subscriptions in v0.1). Credit ledger with reserve/commit/refund/partial_finalize semantics. Idempotency keys per visit attempt; provider-billing reconciliation runs daily.
20. **Self-hosted Supabase** (Postgres + storage + auth) on our infra (per the authoritative project idea). Postgres at-rest encryption (LUKS on the data volume); object-storage at-rest encryption with envelope encryption (data keys wrapped by a KMS-managed root key; quarterly rotation; staging/preview/prod/backup use distinct root keys; access to prod KMS limited to a two-person named-operator list maintained in the ops runbook `RUN-KMS-OPERATORS.md` and reviewed quarterly — the specific operators are named there, not in this spec).
21. Cloudflare DNS / SSL / CDN / WAF rate limits — anonymous browsing 60 RPM/IP; authenticated API 600 RPM/key; study-create 10/min/account and 100/day/account; concurrent in-flight studies per account ≤ 5.
22. **Preview environment per pull request — with strict isolation.** Each preview env runs against: (a) a dedicated ephemeral Supabase project destroyed on PR close; (b) a sandbox Stripe account with a distinct webhook endpoint; (c) a distinct Postmark message stream; (d) a dedicated LLM-provider sub-key with a hard $5/day spend cap and a zero-retention flag; (e) a preview-specific KMS root key distinct from staging/prod/backup. Forked-repo PRs do NOT receive provider keys — preview envs for forks run against stub providers only; secrets are bound to the first-party branch workflow. No path from preview to prod KMS or prod Postgres.
23. Hard daily LLM-spend cap per account with a 50%-of-cap warning email (transactional email via Postmark; magic-link auth emails remain on Supabase Auth).
24. Pluggable LLM provider — `LLMProvider` and `EmbeddingProvider` adapter interfaces ship in v0.1 with **one** chat backend and **one** embedding backend wired. Second wired chat backend + automatic fallback is **v0.3**. Chat and embedding providers are decoupled in v0.1.
25. **Graceful bot-detection failure (tightened).** Capture is classified `blocked` when ANY of these hard signals is present: HTTP 403/429/503 from origin after redirect resolution; known challenge-page fingerprint (Cloudflare `#challenge-form` selector AND body text `Just a moment…` AND no primary content rendered; DataDome captcha iframe AND title contains `DataDome`; PerimeterX `px-captcha` root; hCaptcha/Turnstile root element above-fold AND primary CTA absent from a11y tree); navigation timed out > 30 s on first paint AND DOM text content < 200 chars. **The bare presence of the `__cf_bm` cookie is NOT a block signal** — it is set on most normal Cloudflare-fronted pages. `__cf_bm` contributes to a block verdict ONLY when combined with all of: DOM text content < 200 chars, primary CTA absent from a11y tree, and HTTP status ∈ {403, 429, 503}. On `blocked`, the study fails and the credit reserve is fully refunded. A dedicated CI fixture suite of Cloudflare-fronted pages that render normally (including willbuy.dev's own pricing page behind CF) asserts `ok`, not `blocked`. Full stealth bypass is v0.2.
26. Run resumability — half-finished batches survive worker restart. Job queue uses leases (10-min visibility timeout for visit jobs, 90 s for capture jobs) **separate from** the 120 s per-backstory lease (#10); worker heartbeats every 20 s; DLQ for jobs exceeding `max_attempts` (default 5).
27. Per-account/per-target-domain concurrency budgets (≤ 4 concurrent captures per target eTLD+1 per account; ≤ 8 across all accounts) and a circuit breaker that trips after 5 consecutive failures against a target domain in 5 min. Visitor-worker concurrency limit (default 20) is **per-account**, not global.
28. **Data classification + redact-before-persist.** At study creation, the user submits a machine-readable consent object (`acknowledge_third_party_submission: true`, `authorization_mode: "verified_domain" | "public_declared"`) — a simple checkbox is not the control; `authorization_mode` gates capture per #1. Automatic redaction runs **before persistence to object storage AND before model submission** on the a11y-tree for: prefixed key patterns (`sk-[A-Za-z0-9]{20,}`, `xoxb-[A-Za-z0-9-]{20,}`, `AKIA[A-Z0-9]{16}`, `ghp_[A-Za-z0-9]{36}`, `ghs_…`, `ghu_…`, `glpat-…`), JWTs (`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`), RFC5322 emails; AND generic 32+ char base64/hex tokens ONLY when they appear within 32 chars after a label matching `(?i)(token|secret|api[_-]?key|password|bearer|authorization)`. Plain content-addressed hashes — asset URL hashes, CSS `script-src` nonces, commit SHAs on changelog pages, product SKUs, cache-busted image URLs — are NOT redacted. Redaction is on by default; disabling requires a second explicit confirmation per study. A second scrub runs on cluster labels and on any string that reaches `/r/*` — any redaction pattern triggering there is replaced with `[REDACTED:kind]`. The redactor is versioned; a golden-fixture suite covers both positives and false-positives (§6).
29. **End-to-end data retention.** Debug artifacts (raw a11y-tree dumps, screenshots, full LLM transcripts, per-attempt raw outputs) retained 30 days then deleted. Report-facing aggregates retained 1 year. Account deletion purges everything including backups on the next backup rotation via a tombstone replay — fulfilled within 7 days of request. Also: Postgres backups rolling 14-day retention with account-delete tombstone replay on restore; worker structured logs 14-day retention with URLs hashed (never raw), tokens never emitted; traces 7-day retention at 1% sample with same redaction; Cloudflare log-retention 7 days with query strings stripped on `/r/*`; Postmark message archive 7 days (configured per message stream and verified in setup); LLM provider retention configured to zero-retention where the provider offers it (v0.1 chat provider does), else 30-day. Public report assets never include raw transcripts or screenshots.

### Out of scope (explicitly deferred)
- **v0.2:** stealth bypass of bot detection, mobile UI, >2 URLs per study, Stripe subscriptions / billing portal / dunning, user-defined output schemas, configurable conversion-binarization thresholds, automatic PII detection beyond what #28 specifies.
- **v0.3:** calibration against real analytics (GA / Amplitude / PostHog), second wired LLM chat provider with automatic fallback.
- **Not planned:** team accounts, SSO, white-label, enterprise contracts, acting on shipped traffic, i18n, collaboration/sharing UX beyond per-link share tokens.

## 3. User stories

1. **Indie SaaS founder iterating on pricing pre-PMF.** Mira ships a $49/mo Postgres-ops tool and gets 40 visits/day — not enough to A/B. She verifies her domain via DNS TXT, pastes a new `pricing.example.com` + the prior variant, picks `saas_founder_pre_pmf` and `devtools_engineer`, runs N=30 paired. In 90 s she sees the new variant's top unanswered blocker is "is this self-hosted?", paired-delta will_to_buy is +1.3 (paired-t and Wilcoxon both p<0.05), and she ships a copy fix the same afternoon.
2. **Shopify merchant testing a checkout flow.** Kenji sells ergonomic keyboards. He verifies his domain, pastes his new one-page checkout URL, picks `shopify_merchant`, N=30, single-URL. Report flags "shipping cost not visible above fold" (18/30 cluster) and "return policy unclear" (11/30). He fixes both, re-runs — clusters shrink to 3/30 and 1/30. Total spend ~$3 (60 visits at v0.1 cost-model defaults; see §5.6).
3. **CRO consultant auditing a client's landing page.** Dana runs a boutique CRO practice. Her client uploads a one-time verification file for auth, she pastes their enterprise-DB vendor landing page + a competitor's (`authorization_mode: "public_declared"` for the competitor, which passes the automated public-reachability probe), picks `fintech_ops_buyer`, N=50 paired. She mints a private share link with 30-day expiry and embeds it in her deliverable. She closes the $4k audit engagement in 2 days instead of 2 weeks.
4. **Willbuy dogfooding itself.** Before public launch, the team runs willbuy.dev's own pricing page with N=30 across all 5 preset ICPs. Top-3 blockers inform copy/layout fixes before Show HN.

## 4. Architecture

<!-- architecture:begin -->

```text
(architecture not yet specified)
```

<!-- architecture:end -->

### 4.1 Components
- **Web app** — Next.js 14 + Tailwind + TypeScript. Marketing, signup, dashboard, study-creation UI (with verified-domain and public-declared flows), report pages. `dangerouslySetInnerHTML` banned by ESLint. Strict CSP on all authenticated and `/r/*` routes.
- **API server** — Node 20 + Fastify + TypeScript. REST for study create/get/list, credits, API-key auth, report data, Stripe webhook, share-token issuance/revocation, atomic spend debit, single-writer study finalize. Target-authorization enforcement lives here.
- **Capture worker** — Node + Playwright (headless Chromium) inside a Firecracker microVM. Default-deny egress firewall allow-lists the resolved target IPs + explicit subresource hosts up to the 50-host budget. No-side-effects browser policy enforced via Playwright routing + permission denial. One microVM per capture, torn down at completion.
- **Visitor worker** — Node + TypeScript. Pulls visit jobs, acquires per-backstory lease, calls `LLMProvider.complete()` with backstory + captured page, validates JSON, runs schema-repair retries (each fresh-context) and transient-error retries with backoff, writes visit row and attempt rows.
- **Aggregator worker** — Runs when all visits reach terminal state or the 3-min timeout from `study.created_at` fires. Embedding + HDBSCAN clustering, conversion-weighted score, paired statistics. Holds single-writer lock on the study before transition to `ready`.
- **Reconciliation job** — Daily. Compares provider billing line items against `visit_attempts`; resolves `indeterminate` attempts into refund or commit; writes `cost_discrepancies` on > 1¢ unexplained deltas.
- **LLM adapter layer** — `LLMProvider` (chat) + `EmbeddingProvider` (embeddings). v0.1 wires 1 of each. Capability flags on the provider object declare idempotency support, zero-retention support, and structured-output support. No vendor SDK identifiers leak above this layer. Adapter-lint CI rule forbids `conversation_id`/`session_id`/`thread_id`/`previous_response_id`/`cached_prompt_id` in adapter call sites.
- **Postgres (self-hosted Supabase)** — tables listed in the diagram. All state transitions use `SELECT … FOR UPDATE SKIP LOCKED` where concurrent.
- **Object storage (Supabase storage, envelope-encrypted)** — 30-day TTL on debug artifacts; account/study delete purges immediately and propagates to the next backup rotation.
- **Stripe** — Checkout for credit packs; signed webhook idempotent on event id.
- **Postmark** — transactional email (cap warnings, share-link notifications, account events). Auth magic-link emails on Supabase Auth.
- **Cloudflare** — DNS, SSL, CDN, WAF rate limits; `/r/*` cache bypass page rule; log-field configuration strips query strings on `/r/*`.

### 4.2 Key boundaries
- **Backstory isolation.** A backstory string lives in exactly one in-flight LLM context at a time, enforced by the per-backstory lease. Paired A/B is a DB join over results.
- **Fresh-context invariant.** Every LLM call constructs a new message array. Schema-repair retries also start fresh — prior raw output is passed as user-role data, never as an assistant turn. Adapter-lint forbids continuation identifiers.
- **Capture-once-per-URL-per-study.** All N visitors consume the same capture snapshot.
- **Sandbox containment.** Capture workers cannot reach internal services, cloud metadata, RFC1918 hosts. Egress allow-listed per-job to resolved IPs; DNS rebinds at fetch time rejected.
- **Render boundary.** Captured text + LLM output + cluster labels render as escaped text under strict CSP with a markdown allow-list (§5.10); `dangerouslySetInnerHTML` is banned.
- **Pluggable LLM.** Workers depend only on `LLMProvider` / `EmbeddingProvider`.
- **Trust surface around captured content.** Never executed server-side, never used to choose a tool call, only embedded as user-role content. Redaction runs before persist and before submission.
- **Preview isolation.** Preview envs have their own KMS / Supabase / Stripe sandbox / Postmark stream / LLM sub-key with a $5/day hard cap. Forked-repo PRs get stubs only.

### 4.3 Key abstractions
- `Account { id, email, verified_domains[], …}`
- `Study { id, account_id, mode: single|paired, urls[], authorization_mode, icp_id | custom_icp, n, seed, status, cost_cents, created_at }`
- `Backstory { id, study_id, idx, icp_id, structured_fields, rendered_text }`
- `BackstoryLease { backstory_id PK, holder_visit_id, lease_until, heartbeat_at }`
- `PageCapture { id, study_id, url, url_hash, a11y_tree_json_key, screenshot_key, captured_at, status, breach_reason?, host_count }`
- `Visit { id, study_id, backstory_id, variant_idx, capture_id, provider, model, output_json, status, terminal_reason?, latency_ms, cost_cents }` UNIQUE(study_id, backstory_id, variant_idx)
- `VisitAttempt { id, visit_id, attempt_idx, kind, idempotency_key, provider_request_id, raw_output_key, error_class, cost_cents, status: started|ended|indeterminate, started_at, ended_at }`
- `Job { id, kind: capture|visit|aggregate|reconcile, ref_id, lease_until, heartbeat_at, attempts, max_attempts, dlq }`
- `Report { id, study_id UNIQUE, clusters_json, scores_json, paired_delta_json, default_share_token_id }`
- `ShareToken { id, report_id, token_hash, created_at, expires_at, revoked_at? }`
- `LateArrival { id, study_id, visit_id, arrived_at, payload_key }`
- `CreditLedger { id, account_id, study_id, visit_id?, kind: reserve|commit|refund|partial_finalize, cents, idempotency_key UNIQUE, created_at }`
- `ErrorEvent { id, account_id?, study_id?, visit_id?, kind, payload_ciphertext, created_at }` (30-day TTL)

## 5. Implementation details

### 5.1 End-to-end data flow — paired A/B (N=30)
1. User submits `{ urls: [A, B], icp: "saas_founder_pre_pmf", n: 30, seed: 42, redact: true, authorization_mode: "verified_domain", acknowledge_third_party_submission: true }`.
2. API server enforces target-authorization (§2 #1): each URL's eTLD+1 is either in `account.verified_domains` OR `authorization_mode="public_declared"` AND the URL passes the automated public-reachability probe AND isn't blocklisted.
3. API server validates credits, **atomically reserves** estimated cost on the ledger (§5.4), creates `Study` + 30 `Backstory` rows (seeded sample).
4. 2 capture jobs enqueued. Capture worker leases a job (90 s visibility, 20 s heartbeat), boots a fresh Firecracker microVM, runs Playwright under the no-side-effects policy, waits for `networkidle` + lazy-load settle, DOM-removes known banner selectors, extracts a11y tree, redacts BEFORE persistence, stores artifacts, flips status to `ok` (or `blocked` → study fails, reserve refunded).
5. 60 visit jobs enqueued (30 backstories × 2 variants). Visitor workers pull under a per-account concurrency limit (default 20). A visit job acquires the per-backstory lease (row in `backstory_leases`, 120 s lease_until, 15 s heartbeat) before starting; if the other variant for this backstory already holds the lease, the job is requeued with jittered exp backoff (100 ms → 400 ms → 1.6 s, capped at 1.6 s, unlimited retries until its own visit-job lease expires).
6. Each visit: atomic spend debit (§5.5) → if reserved, construct fresh-context prompt (system = visitor role + schema, + backstory, + redacted a11y tree ≤ 30k tokens by pinned tokenizer) → call provider with idempotency key = `sha256(visit_id||attempt_idx)` and `max_tokens=800`. Schema violation → up to 2 schema-repair retries, each a brand-new request (no assistant turn carried over). Transient error → up to 3 retries with backoff. Provider `timeout` / `connection_reset` / `unknown_status` on a non-idempotent adapter → classify `indeterminate`, pessimistically debit at 5¢, stop retrying, let reconciliation resolve.
7. When all 60 visits are terminal OR 3-min timeout from `study.created_at`, aggregator acquires the single-writer lock on the study (§5.11), runs embedding (sorted/normalized input) + HDBSCAN (fixed `random_state`), LLM cluster labels, conversion-weighted score, paired-δ + paired-t + Wilcoxon + McNemar's (with §2 #16 binarization). Writes report. Any post-commit late visits land in `late_arrivals`.
8. Ledger `partial_finalize` commits per-ok visit charges; refunds everything else.

### 5.2 End-to-end data flow — single URL (N default 30)
Same as §5.1 except: 1 capture job; N visit jobs (single variant, no backstory-lease contention); aggregator skips paired-δ, McNemar's, and the second variant. Default N=30; min 5; max 100 in v0.1.

### 5.3 State transitions
- `Study`: `created → capturing → visiting → aggregating → ready | failed`.
- `Visit`: `pending → leased → ok | failed`. `failed.terminal_reason` ∈ {`schema`, `transient`, `cap_exceeded`, `provider_error`, `lease_lost`, `indeterminate`}.
- `VisitAttempt`: `started → ended | indeterminate`.
- `PageCapture`: `pending → leased → ok | blocked | error`.
- `Job`: `queued → leased (lease_until, heartbeat_at) → done | requeued | dlq`.
- `BackstoryLease` rows are INSERTed on acquisition, UPDATEd on heartbeat, DELETEd on visit terminal or expiry.

### 5.4 Credit ledger semantics
- `reserve(account_id, study_id, cents)` — hold at study creation. Idempotent on `study_id`.
- `commit(account_id, study_id, visit_id, cents)` — finalize `ok` visit. Idempotent on `visit_id`.
- `refund(account_id, study_id, visit_id, cents, reason)` — release reservation for `failed`/`indeterminate_refunded`. Idempotent on `visit_id`.
- `partial_finalize(study_id)` — at study terminal, commit over `ok` visits, refund remainder. A study finishes `ready` iff `count(ok) ≥ min_ok_visits(n)` where **`min_ok_visits(n) = max(5, ceil(0.67 × n))`**. So: n=5→5, n=10→7, n=20→14, n=30→20, n=50→34, n=100→67.
- `reconcile_provider_billing(date)` — daily job. Pulls provider cost report, compares per-attempt. `indeterminate` attempts resolved: if provider charge matches → commit, else → refund and mark `indeterminate_refunded`. Unexplained orphan spend → `cost_discrepancies` + operator alert.

### 5.5 Spend-cap enforcement (atomic, race-free)
Before any outbound provider call, the worker performs a single SQL transaction:
```sql
INSERT INTO llm_spend_daily (account_id, date, cents)
  VALUES ($account, CURRENT_DATE, $est_cents)
  ON CONFLICT (account_id, date)
  DO UPDATE SET cents = llm_spend_daily.cents + EXCLUDED.cents
  WHERE llm_spend_daily.cents + EXCLUDED.cents <= $daily_cap
  RETURNING cents;
```
No `RETURNING` row → reservation failed → visit transitions to `failed: cap_exceeded`, refund posted, **no provider call made**. On provider-call completion, a reconciling row adjusts actual vs estimated cost (delta debited or refunded). `est_cents` is the per-visit hard ceiling (5¢), so pessimistic accounting holds even for `indeterminate` attempts. The 50%-of-cap email is gated by a `UNIQUE(account_id, date, kind='cap_50_warning')` row in a side table, so exactly one email fires per account per day. §6 includes a 40-concurrent-writer test at 99.9% of cap.

### 5.6 Cost model (v0.1 defaults)
- Chat: **`claude-haiku-4-5`** (Anthropic). Price snapshot at spec date: ~$1/MTok input, ~$5/MTok output.
- Embedding: **`voyage-3-lite`** (Voyage AI). Price snapshot: ~$0.02/MTok.
- Visitor call: ~6k input + ~600 output → est. `6 × 1¢ + 0.6 × 5¢ = ~0.9¢`. With prompt-caching on the stable system block, effective ~0.5¢. We conservatively budget **3.5¢/visit** for long-tail inputs, repair retries, and pricing volatility.
- Embedding call: ~30 findings × ~30 tokens → est. 0.05¢/visit.
- Cluster-label call: ~12 calls/study × ~300 tokens → est. 1.5¢/study.
- **Per-visit hard ceiling: 5¢.** Caps all retries and `indeterminate` pessimism.
- Reference run (User story #2): 30 visits × 3.5¢ + 1.5¢ ≈ $1.06; two runs ≈ $2.10.
- Credit-pack tiers: $29 (1,000 credits ≈ 285 visits), $99 (4,000 credits ≈ 1,140 visits), $299 (15,000 credits ≈ 4,280 visits). Pricing locked for v0.1; revisited after the benchmark.

### 5.7 Algorithms
- **Backstory sampling.** Each archetype defines categorical distributions over `stage`/`team_size`/`stack`/`pain`/`entry_point`/`budget_authority` plus a free-text "quirk" draw. RNG seeded by `(seed, study_id, idx)`.
- **Paired-δ.** For each backstory i with both visits `ok`: `δ_i = will_to_buy_B_i − will_to_buy_A_i`. Report mean, 95% CI, paired-t, Wilcoxon signed-rank. Binary `next_action` collapsed per §2 #16 → McNemar's on 2×2 discordant pairs.
- **Conversion-weighted score.** Per variant `score = Σ w[next_action_i] / n_ok`.
- **Clustering (deterministic).** Lowercase + whitespace-normalize findings; dedupe; sort lexicographically; embed (L2-normalized); HDBSCAN(`min_cluster_size=3`, fixed `random_state`, `approx_min_span_tree=False`); tie-breaks by sorted input order. One LLM call per cluster for a ≤ 8-word label.
- **Truncation.** A11y-tree ordered: pricing → above-fold CTAs → remaining reading order. Greedy truncate to 30k tokens per the pinned chat-provider tokenizer.

### 5.8 Security / abuse
- API key = 32-byte random, `sk_live_` prefix, hashed in DB. ≤ 2 active per account.
- Captures only in server-side Firecracker microVMs with default-deny egress. URL validator blocks private IPv4/IPv6, localhost, link-local, cloud metadata; snapshots resolved IPs and rejects DNS rebinds at fetch. Sandbox firewall is second line.
- Captured text is treated as untrusted data — user-role content only, never tool-call selection.
- Report URLs require a 22-char unguessable `nanoid` token. Default `noindex`. Owner can revoke; expired tokens → 410 Gone. Every token-bearing response has `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP. On revoke the CDN cache is purged.
- Stripe webhook signature verified; `event.id` as ledger idempotency key.
- Render-bomb defenses: per-job CPU/RAM/wall/byte/DOM/host caps; per-account/per-domain concurrency budgets; per-domain circuit breaker after 5 consecutive failures in 5 min.

### 5.9 Data classification & redaction
All captured content classified `customer-third-party`, never reused outside the requesting account. Redaction runs **before persistence** to object storage and **before LLM submission** per §2 #28. Labeled-context rule for generic 32+ char base64/hex tokens prevents false-positives on asset hashes, nonces, SHAs, SKUs. Second-pass scrub runs on everything that reaches `/r/*` (cluster labels, aggregated strings). The redactor is versioned (`redactor_v=1` recorded per study) and has a false-positive golden-fixture suite (§6.1).

### 5.10 Untrusted-content render boundary
All captured page text, LLM output strings, cluster labels, and URLs displayed in dashboards or `/r/*` use these controls:
- **React auto-escaping** everywhere; `dangerouslySetInnerHTML` banned by ESLint rule `react/no-danger` (CI-enforced).
- **Markdown** of LLM strings via `react-markdown` with allow-list `[p, ul, ol, li, strong, em, code]`; raw HTML rejected; non-`http(s)` autolinks rejected.
- **CSP** on `/dashboard/*` and `/r/*`: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'`.
- **Additional headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()`.
- Captured URLs are rendered as `<code>` text, never as hyperlinks, on both dashboard and `/r/*`.

### 5.11 Study finalization (single-writer)
The aggregator runs inside a transaction:
```sql
SELECT 1 FROM studies WHERE id = $1 AND status = 'aggregating' FOR UPDATE;
```
It writes `status = 'ready'` only if all visits are terminal and `count(ok) ≥ min_ok_visits(n)`; otherwise `status = 'failed'`. `UNIQUE(reports.study_id)` guarantees exactly one report. Late-arriving visits that find `studies.status ∈ {'ready','failed'}` write to `late_arrivals(study_id, visit_id, arrived_at, payload_key)` and do NOT mutate the report. The 3-min aggregate timeout is measured from `studies.created_at`; a visit still holding its 10-min lease past that point is allowed to complete but routes to `late_arrivals`. The per-backstory lease is released on visit terminal commit OR on `backstory_leases.lease_until` expiry.

### 5.12 Field-level logging & observability policy
Structured logs, traces, and error events emit only: `account_id`, `study_id`, `visit_id`, `attempt_idx`, event name, duration, error class. They NEVER emit: raw URLs, share tokens, API keys, provider payloads, a11y-tree content, LLM output strings, backstory text, email addresses, captured page bytes. URLs are logged as salted SHA-256 hashes (`url_hash`). Share tokens are never logged — a routing middleware strips them from `:path` before any log sink receives the record. API keys are masked to the last 4 chars. Payload-bearing error context goes to the encrypted `error_events` table (30-day TTL, same KMS root as debug artifacts) and is referenced from logs by `error_event_id`. Cloudflare log-field configuration strips query strings on `/r/*`. Postmark message-stream logs exclude email body content (only message id + recipient domain).

## 6. Tests plan

### 6.1 Red/green TDD — built test-first
- `computePairedDelta` — fixtures for mean, 95% CI, paired-t, Wilcoxon, McNemar's with §2 #16 binarization.
- `computeConversionScore` — weight-map tables; edges (all-leave, all-purchase, single visitor).
- `sampleBackstory` — same seed + idx → identical; marginals match ICP spec over N=10k within tolerance.
- `validateVisitOrRetry` — malformed outputs at every required field; over-cap string lengths; schema-vs-transient retry classification; retry-budget boundaries; schema-repair retry builds a new message array (no carried-over assistant turn).
- Credit ledger — double-spend impossible, negative balance impossible, concurrent debits under FOR UPDATE, `partial_finalize` fixtures for ok/cap_exceeded/schema-failed mixes.
- `atomicSpendReservation` — 40 concurrent callers at 99.9% of cap; cap NEVER exceeded; reservations that fail issue zero provider calls.
- `minOkVisitsFormula` — `min_ok_visits(n)` for n ∈ {5, 10, 20, 30, 50, 100}.
- URL validator (SSRF guard) — IPv4 private, IPv6 ULA, localhost, link-local, AWS/GCP/Azure/Oracle/DO metadata, DNS-rebind at fetch.
- `targetAuthorization` — verified-domain match; `public_declared` passes probe + blocklist; signed-preview hosts rejected; staging subdomain patterns rejected.
- `redactCapture` — **positive fixtures** (`sk-`, `xoxb-`, `AKIA`, `ghp_`, `glpat-`, JWTs, emails, labeled-context hex) all redacted; **false-positive fixtures** (40-char asset-URL hash, 64-char CSP nonce, 64-char SKU, commit SHA, cache-busted image URL) NOT redacted; preserves a11y-tree structure when disabled.
- `classifyBlocked` — positive fixtures for every §2 #25 signal; **false-positive fixtures:** 20 Cloudflare-fronted pages (including willbuy.dev's own) with `__cf_bm` that render normally all classify `ok`.
- `adapterContract` — grep-lint asserts no adapter call site passes `conversation_id`/`session_id`/`thread_id`/`previous_response_id`/`cached_prompt_id`; capability flags typed and enforced.
- `finalizeSingleWriter` — 10 concurrent aggregators for one study; exactly one commits `ready`; late visit lands in `late_arrivals`.
- `backstoryLease` — separate row from visit lease; blocks concurrent A/B; released on visit terminal; reclaimed after `lease_until`; backoff policy exercised.
- `noSideEffectsBrowser` — fixture page with POST, form submit, download, service-worker register, popup, `sendBeacon`; capture records zero side effects.
- `JobLease` — heartbeat extends; missed heartbeat reclaims; max_attempts → DLQ.
- `cspHeaders` / `noDangerLint` — ESLint rule fails build on `dangerouslySetInnerHTML`; CSP header present on all targeted routes.

### 6.2 CI tests
- **Unit** — all modules above plus a11y-tree serializer, truncator (pinned tokenizer), cluster-labeler adapter, cost estimator, target-auth probe.
- **Integration** — full URL→report loop against a fixture server with stub LLM returning schema-valid fixtures. Target: < 30 s at N=5.
- **Paired-A/B isolation** — (a) a backstory never appears in the OTHER variant's recorded transcript; (b) adapter call logs show distinct idempotency keys per call and no continuation identifiers; (c) prompt-assembly call counter increments once per call (fresh array asserted); (d) per-backstory lease blocks simultaneous A/B even under 50-thread contention.
- **Schema-repair freshness** — on repair retry, the request contains zero assistant-role messages; prior raw output appears only as user-role content.
- **Atomic-spend concurrency** — 40 parallel debits at 99.9% cap; cap never exceeded; exactly-once 50% email.
- **Resume-after-restart** — kill workers mid-flight; restart; no duplicate visits (UNIQUE + lease); lease reclaim works past `lease_until`.
- **Reproducibility (pure layers)** — same seed → identical backstories; given fixtured LLM outputs, aggregator produces identical clusters (sorted-input + fixed `random_state` guarantees float stability across CPUs) and identical paired-δ. Semantic stability on real provider runs nightly (cluster-label ≥ 80% match at temperature=0; per-backstory δ within ±0.5) — NOT CI gating.
- **Cap enforcement** — seeded at 99% cap; next visit `cap_exceeded` and refunded without provider call.
- **Stripe webhook** — idempotent on event-id under retry storms.
- **Sandbox containment** — capture attempts to reach `169.254.169.254`, `127.0.0.1`, RFC1918, internal hostnames all fail; DNS-rebind defeated.
- **Egress policy** — fixture page with 60 third-party hosts aborts at the 50-host budget; HTTPS→HTTP redirect blocked; cross-eTLD+1 redirect re-checked.
- **Render-bomb** — DOM/RAM/byte caps enforced; per-domain circuit breaker trips after 5/5min.
- **XSS on captured content** — capture fixture containing `<script>alert(1)</script>`, `javascript:` links, markdown injection in LLM output; dashboard and `/r/*` render them as escaped text; CSP blocks inline script.
- **Share-token leak paths** — `/r/<slug>` responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; request logs during these requests contain no token; Cloudflare page rule asserts cache bypass; on revoke, cache purge fires.
- **Blocked-classifier false-positive** — 20 normal Cloudflare-fronted pages classify `ok`.
- **Redactor false-positive** — benign asset contexts never redacted.
- **Adapter lint** — a PR adding `conversation_id` at an adapter call site fails CI.
- **Account-delete tombstone on backup** — tombstone replay on a restored fake backup yields no residue of the deleted account.
- **Preview-env isolation** — forked-repo preview runs against stubs; no prod secrets reachable from a preview worker.
- **Perf regression** — stub provider at realistic latencies (p50 1.2 s / p95 4 s per visit) at N=30 paired (60 visits); end-to-end wall-clock ≤ 120 s; per-stage budgets asserted.

### 6.3 Manual / bench tests (ship gates)
- **5-pricing-page benchmark** — Stripe, Linear, Supabase, PostHog, and willbuy.dev's own. **Two independent CRO experts** blind-flag top-3 issues per page against a pre-registered rubric (what counts as an "issue"; what counts as "covered"). Inter-rater target **Cohen's κ ≥ 0.6**. If κ < 0.6, **a third independent reviewer labels the same pages without seeing the other two; the final per-page expert-top-3 set is determined by majority rule across the three (an issue is in the set iff ≥ 2 of 3 flag it)**. **Matcher for "tool's top-3 `unanswered_blockers` covers ≥ 2 of the expert top-3":** a separate blinded human adjudicator (not one of the two primary reviewers; a third reviewer if κ failed) judges each candidate pairing against a pre-registered four-verdict rubric (`exact-match`, `paraphrase`, `partial-overlap-covers`, `not-covered`) — the first three count as covered. Embedding cosine similarity may be shown as supporting information but the human verdict is authoritative. The rubric, fixtures, adjudicator identity, matcher code, and a tie-break procedure for `partial-overlap` edge cases are all committed to the repo before the benchmark run begins. A hand-seeded fixture page with 3 known planted issues must surface all 3. Pass: ≥ 2 covered per page AND 0 obvious false positives per page. **Hard ship gate.**
- **2-minute budget** — URL→report for N=30 paired (60 visits) at default concurrency, ≤ 120 s against real providers (in addition to the CI perf test). **Hard ship gate.**
- **Dogfood** — run on willbuy.dev's own pricing page; act on top-3 blockers. **Hard ship gate.**
- **Restart-during-run drill** on staging: one successful run with workers killed mid-flight. **Hard ship gate.**
- **Sandbox red-team** — security reviewer attempts Firecracker escape + egress to internal services from inside a capture microVM; both must fail. **Hard ship gate.**
- **Backup/restore drill** — Postgres + object-store backup restored to clean env; known study renders; account-delete tombstone correctly applied. **Hard ship gate.**
- **Render-boundary manual QA** — captured malicious fixtures render safely under the CSP. **Hard ship gate.**
- **Field-log audit** — reviewer greps a week of staging logs for URLs / tokens / emails / API keys; zero hits. **Hard ship gate.**

## 7. Team (veteran experts to hire)
- **Veteran LLM prompt engineer / eval expert (1)** — visitor prompt, ICP archetype library, output schema (with length caps), retry policy, clustering determinism, reproducibility harness, 5-page benchmark tuning, adapter contract.
- **Veteran conversion research / qualitative-UX expert (2, part-time ~4 weeks)** — co-author the 5 ICP archetypes, define output-schema categories, serve as the two independent blind human evaluators on the 5-page benchmark. External CRO consultants. A third independent reviewer is on-call if κ < 0.6.
- **Veteran full-stack TypeScript engineer (Next.js + Postgres) (2)** — web app, API server, auth, dashboard, report page, Stripe, render-boundary controls (CSP, no-danger lint, markdown allow-list), share-token leak-path controls. Two so frontend and API parallelize.
- **Veteran browser-automation + sandboxing engineer (Playwright + Firecracker) (1)** — capture worker, a11y-tree extraction, SPA / lazy-load / cookie-banner handling, screenshot pipeline, microVM profile, default-deny egress, no-side-effects browser policy, render-bomb ceilings, blocked-classifier (including `__cf_bm` false-positive test corpus).
- **Veteran DevOps engineer (self-hosted Supabase + Cloudflare + KMS) (1)** — infra bootstrap, Postgres backup/restore with account-delete tombstones, preview-env-per-PR with secret isolation, WAF rules, KMS envelope encryption with per-env keys, observability with field-level logging policy.
- **Veteran payments engineer (Stripe credits / ledger) (0.5)** — Checkout, webhook, credit ledger with atomic spend reservation, reserve/commit/refund/partial_finalize, provider reconciliation including `indeterminate` resolution. Can be one of the TS engineers.
- **Veteran security reviewer (part-time / contract, 1 week)** — Firecracker red-team, SSRF, API-key handling, webhook signature, share-token leak model, render-boundary review, adapter-contract verification, field-log audit. One pass before public launch.

## 8. Implementation plan (sprints)

**Sprint 0 — infra bootstrap (week 1).** Parallel:
- DevOps: self-hosted Supabase up; Cloudflare DNS/SSL/WAF; staging + prod; CI (GitHub Actions); preview-env-per-PR with secret isolation for fork PRs; KMS root keys per env (staging/preview/prod/backup).
- TS engineer A: pnpm monorepo scaffold; lint (incl. `react/no-danger`) + CSP middleware; Next.js skeleton at willbuy.dev; API-server skeleton.
- LLM expert: visitor system prompt + output JSON schema with per-field caps; stub `LLMProvider` and `EmbeddingProvider` interfaces with capability flags; adapter-contract lint rule; first TDD suite RED.
- Browser-automation: Firecracker profile (chosen this sprint, not a week-1 spike) + base image; default-deny egress firewall; no-side-effects Playwright harness.

**Sprint 1 — single-URL loop (weeks 2–3).** Parallel:
- Browser-automation: capture worker inside Firecracker, a11y-tree serializer, DOM-remove banner policy, screenshot storage, redact-before-persist, render-bomb ceilings, blocked-classifier with false-positive corpus.
- LLM expert: 5 ICP archetypes, backstory sampler (GREEN), visitor worker with schema-repair (fresh-context) and transient-retry loops (GREEN), wired chat backend (claude-haiku-4-5, zero-retention), wired embedding backend (voyage-3-lite).
- TS engineer A: dashboard, verified-domain flow (DNS TXT / well-known / meta) + public-declared probe, study-creation form, study-detail page, report renderer with CSP + markdown allow-list, share-token UI with leak-path controls.
- TS engineer B: auth (magic link), API-key issue/rotate (≤ 2 active), credit ledger with atomic spend reservation (GREEN), Stripe Checkout + webhook test mode, Postmark integration, field-level logging middleware.
- DevOps: observability with URL hashing + token stripping, KMS envelope encryption on object storage, backup/restore drill script with account-delete tombstone.
- **Milestone:** single-URL N=30 fixture pages end-to-end inside microVM, ≤ 2 min, all pure tests GREEN, atomic-spend concurrency test GREEN.

**Sprint 2 — paired A/B + aggregation + abuse controls (weeks 4–5).** Parallel:
- LLM expert: aggregator (deterministic HDBSCAN, LLM cluster-label), paired-δ worker, paired-A/B orchestration with per-backstory lease + isolation tests GREEN, single-writer finalize GREEN, semantic-stability nightly.
- TS engineer A: paired-A/B UI, report paired-δ view (paired-t + Wilcoxon + McNemar), revoke + expiry UI with Cloudflare cache purge, XSS render-boundary QA.
- TS engineer B: daily spend cap + 50% warning, graceful bot-detection failure + refund path, resume-after-restart GREEN, job lease/heartbeat/DLQ, per-account/per-domain concurrency budgets, circuit breaker, retention deletion jobs (30-day debug TTL + backup tombstone replay), `maybe_executed`/`indeterminate` reconciliation.
- Browser-automation: SPA + lazy-load hardening, blocked-classifier full coverage of §2 #25 including CF false-positive suite.
- DevOps: quantified WAF limits; Stripe live-mode cutover; restore + tombstone drill GREEN; field-log audit tooling.
- Security reviewer (embedded week): Firecracker red-team, SSRF, API key, webhook, share-token leak paths, render-boundary, adapter-contract verification.
- **Milestone:** paired A/B N=30 under 2 min, full aggregation, spend cap holds under concurrency, sandbox containment GREEN, all integration tests GREEN.

**Sprint 3 — benchmark + beta (weeks 6–7).** Serial then parallel:
- Conversion experts (2 external, +1 adjudicator on-call): blind top-3-issues eval on 5 pages; inter-rater κ ≥ 0.6 OR third-labeler majority rule; separate blinded adjudicator runs the covered/not-covered matcher per pre-registered rubric. Hand-seeded fixture page check. Serial gate — must finish before ship.
- LLM expert: tune prompt / schema / clustering against benchmark misses until pass criterion holds.
- Whole team: dogfood willbuy.dev's pricing page, act on top-3 blockers, ship public landing + Show HN draft.
- Beta onboarding: invite ~20 indie hackers / CROs; target 10 first-pack credit purchases at $29–$99 within 4 weeks post-launch (no subscriptions in v0.1).

**Ship-gate checklist for v0.1:** all CI green · atomic-spend concurrency test GREEN · 5-page benchmark passes (κ ≥ 0.6 OR majority rule; hand-seeded fixture caught) · 2-min budget holds (CI + real-provider drill) · dogfood run completed and acted on · Firecracker red-team sign-off · restart-during-run drill on staging · backup/restore + tombstone drill on staging · render-boundary manual QA · field-log audit (zero sensitive hits on a week of staging logs).

## 9. Risks & mitigations (v0.1)
- **Plausible-slop risk.** Two CRO experts + third adjudicator + pre-registered matcher rubric as hard ship gate.
- **Firecracker escape / SSRF via capture.** Hardened microVM profile; default-deny egress; ≤ 50 hosts; per-request DNS pinning; no-side-effects browser policy; security red-team as gate.
- **Public-report data leak.** Private-by-default; unguessable tokens; Cache-Control: no-store + Referrer-Policy: no-referrer + CDN cache bypass + revoke-purges-cache + token-stripping log middleware; raw transcripts/screenshots never on public surface; 30-day debug TTL; per-study and account delete.
- **LLM cost blowouts.** Atomic conditional-increment reservation + 50% warning + per-visit 5¢ ceiling + daily reconciliation + pessimistic `indeterminate` accounting.
- **Bot-detection on client pages.** Tightened classifier (no `__cf_bm` false-positive) + graceful refund in v0.1; stealth bypass v0.2.
- **Provider lock-in.** Adapter interfaces day 1; chat-provider fallback v0.3 (avoids carrying multi-provider risk through launch benchmark).
- **Provider retry ambiguity.** Explicit idempotency capability flag; `indeterminate` state; reconciliation resolves.
- **Self-hosted Supabase ops burden.** DevOps hire + restore + tombstone drill as gate. Escape hatch: switch to hosted Supabase if self-host incident rate exceeds budget in Sprint 3. (Self-host is mandated by the project idea; we do not relitigate it.)
- **Statistical overclaim.** paired-t + Wilcoxon + 95% CI + n_ok always shown; McNemar binarization named; N<20 runs display a low-power warning.
- **Render bombs / asset floods.** Per-job CPU/RAM/wall/byte/DOM/host caps; concurrency budgets; per-domain circuit breaker.
- **Stranded jobs after partition.** Leases + heartbeats + reclaim; DLQ for operator review.
- **Captured PII / secrets reaching providers.** Redact-before-persist and before-submission; labeled-context rule prevents benign false-positives; default-on; explicit consent; 30-day debug TTL; zero-retention provider endpoints where available.
- **Stored XSS via captured content.** React auto-escaping; `dangerouslySetInnerHTML` banned; markdown allow-list; strict CSP; captured URLs rendered as `<code>` text.
- **Secret leak via preview envs.** Fork PRs get stubs only; per-PR KMS + Supabase + Stripe sandbox + Postmark stream + LLM $5/day sub-key; no path from preview to prod.
- **Late-visit mutation of a finalized report.** Single-writer aggregator lock + `late_arrivals` table.
- **Log-as-second-data-store.** Field-level logging policy; URL hashing; token stripping; encrypted `error_events` with matching TTL; weekly field-log audit.

## 10. Changelog
- **v0.3 (2026-04-24)** — hardened v0.2 per two reviewer passes. Added: (1) target authorization via verified-domain (DNS TXT / well-known / meta) + `public_declared` attestation with automated reachability probe and blocklist, replacing the weak checkbox; (2) Firecracker chosen in v0.1 as the single sandbox (gVisor rejected as a weaker isolation boundary for arbitrary third-party JS); (3) no-side-effects browser policy (block non-GETs, form submits, downloads, service workers, popups, permissions; DOM-remove banners instead of clicking); (4) quantified egress policy (≤ 50 distinct hosts, per-request DNS pinning, cross-eTLD+1 redirect re-check, HTTPS→HTTP blocked); (5) atomic spend reservation via single-SQL conditional increment + 40-writer concurrent CI test; (6) provider idempotency contract with `maybe_executed`/`indeterminate` state and daily reconciliation; (7) share-token leak-path controls (Cache-Control: no-store, Referrer-Policy: no-referrer, log/analytics token-stripping middleware, Cloudflare cache bypass + revoke-purges-cache); (8) untrusted-content render boundary (ESLint `react/no-danger`, markdown allow-list, CSP, nosniff, permissions-policy, captured URLs as code); (9) end-to-end retention spanning backups, worker logs, traces, Cloudflare logs, Postmark, and zero-retention provider endpoints; (10) redact-before-persist + before-submission with labeled-context rule and false-positive fixture suite; (11) preview-env secret isolation (dedicated Supabase/Stripe/Postmark per-PR, fork PRs → stubs, $5/day LLM sub-key, distinct KMS root); (12) single-writer study finalize with `late_arrivals`; (13) field-level logging policy (URL hashing, token stripping, encrypted `error_events`); (14) architecture diagram filled; (15) named v0.1 models `claude-haiku-4-5` + `voyage-3-lite`; (16) `min_ok_visits(n) = max(5, ceil(0.67 × n))`; (17) adapter-contract lint banning `conversation_id`/`session_id`/`thread_id`/`previous_response_id`/`cached_prompt_id`; (18) ship-gate matcher: blinded third-party human adjudicator with pre-registered four-verdict rubric; κ < 0.6 → third labeler + majority rule; (19) tokenizer pinned (chat-provider's own, version-locked); (20) output field length caps + `max_tokens=800`; (21) tightened `__cf_bm` blocked-classifier rule + CF-fronted false-positive fixture suite; (22) HDBSCAN determinism (sorted input + L2 norm + fixed `random_state`); (23) backstory lease as separate row with 120 s lease, 15 s heartbeat; (24) backoff policy for per-backstory-lease contention (100 ms → 400 ms → 1.6 s jittered); (25) 3-min aggregate timeout anchored to `studies.created_at`; (26) visitor-worker concurrency limit (default 20) is per-account. Version correction: chat-provider fallback is v0.3 (was inconsistently labeled v0.2 / v0.2-followup in v0.2). Rejected: dropping self-hosted Supabase or preview-env-per-PR — the authoritative project idea mandates self-hosted Supabase, and preview-env is retained with the added isolation controls. Deferred: none beyond prior out-of-scope.
- **v0.2 (2026-04-24)** — security and correctness pass driven by reviewer findings. Added: sandboxed capture, private-by-default reports with revocable share tokens and 30-day debug-artifact TTL, per-backstory lease for paired-A/B isolation, fresh-context schema-repair retries, separate retry classes for schema vs transient errors with per-visit cost ceiling, reserve/commit/refund/partial_finalize ledger, job leases + heartbeats + DLQ, per-account/per-domain concurrency budgets and circuit breaker, 2 concurrent API keys with last_used_at + revoke, KMS envelope encryption with env separation, data classification + redaction + capture consent, retention policy, explicit bot-detection classifier rules, single-URL data-flow section, cost model + credit-pack tiers, Postmark for transactional email, quantified WAF limits, Wilcoxon alongside paired-t, named McNemar binarization, pinned embedding provider. Re-scoped provider fallback. Strengthened tests. Filled architecture diagram. Reframed Sprint 3 commercial target.
- **v0.1 (2026-04-24)** — initial scaffold. Scope, architecture, team, sprint plan, tests plan, ship gates established. No prior versions.
