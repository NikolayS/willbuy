# SPEC amendments — willbuy

Append-only. Each entry is dated and links the PR + issue that drove it.

---

## 2026-04-24 — A1: `next_action` enum + conversion-weighted score align with growth scoring rubric

**Affects:** §2 #15 (visitor output schema — `next_action` enum), §2 #18 (conversion-weighted aggregation weights), §2 #19 (paired statistics — McNemar binarization rule).

**Driver:** Issue #4 (PR `feat/4-shared`). The growth team's `ab/pricing-page-2026apr/scoring.md` (postgres-ai/growth) is the authoritative pricing-page rubric for the willbuy.dev launch dogfood study (§3 user story #4) and the postgres.ai pricing experiment that funds it. The pricing page optimizes for **paid conversion**, not free-tier signups. The rubric in §2 #18 (`purchase`, `contact_sales`, `signup_free`, `bookmark`, `browse_more`, `leave`) was drafted ahead of that growth work and undercounts paid intent (it has no slot for `book_demo`, `start_paid_trial`, `ask_teammate`, or paid-tier-anchored bookmarking) and treats `signup_free` as inherently a partial win. The growth rubric splits paid vs free-with-paid-consideration and adds a tier-aware bump.

**Amendment.** The `next_action` enum and conversion-weighted score adopt the growth rubric verbatim:

`next_action` enum (8 values, replaces the 6-value list in §2 #15 and §2 #18):

- `purchase_paid_today`
- `contact_sales`
- `book_demo`
- `start_paid_trial`
- `bookmark_compare_later`
- `start_free_hobby`
- `ask_teammate`
- `leave`

Conversion-weight base map (replaces §2 #18):

| `next_action`              | Base weight |
| -------------------------- | ----------- |
| `purchase_paid_today`      | 1.0         |
| `contact_sales`            | 0.8         |
| `book_demo`                | 0.8         |
| `start_paid_trial`         | 0.6         |
| `bookmark_compare_later`   | 0.0 (bumped to 0.3 if `tier_picked_if_buying_today` ∈ paid) |
| `start_free_hobby`         | 0.0 (bumped to 0.2 if `highest_tier_willing_to_consider` ∈ paid) |
| `ask_teammate`             | 0.2         |
| `leave`                    | 0.0         |

`paid_tiers = {"express", "starter", "scale", "enterprise"}` (per growth rubric).

`scoreVisit(parsed, tierToday?, considered?)` returns the bumped weight per the rules above; unknown actions return `0.0`.

**McNemar binarization (§2 #19) follow-on.** Update the canonical v0.1 rule: `converted = 1 IFF next_action ∈ {purchase_paid_today, contact_sales, book_demo, start_paid_trial}`; otherwise `0`. (`bookmark_compare_later` and `start_free_hobby` remain `0` for the binary collapse even when their bump fires — the bump is an intent-strength gradient, not a conversion event.) The "paired score is a different quantity than the binary collapse" disclaimer in §2 #19 still applies.

**What is NOT changed.** Per-field length caps (§2 #15: `first_impression` ≤ 400, list items ≤ 200, ≤ 10 items per list, `reasoning` ≤ 1200), `max_tokens=800`, schema-repair retry semantics (§2 #14), idempotency contract (§2 #15/#16), paired-stats disagreement rule (§2 #19) — all unchanged.

**Backstory dimensions.** §2 #5 enumerates backstory fields generically (stage, team_size, stack, pain, entry point, budget authority); the growth repo's `personas/backstories.md` pins concrete value sets for the launch dogfood and the postgres.ai study. Issue #4 wires those concrete value sets into the zod schema. This is a refinement of §2 #5 within its existing shape, not a deviation; recorded here for traceability.

**Tracking.** PR #N (set on merge). Future spec rev rolls this amendment back into §2 #15 / §2 #18 / §2 #19 inline.

---

## 2026-04-24 — A2: HDBSCAN `metric='euclidean'` on L2-normalized embeddings is equivalent to `metric='cosine'`

**Affects:** §17 (HDBSCAN params: `cosine distance`).

**Driver:** PR #39 (issue #31). Spec §17 specifies `cosine distance` for HDBSCAN; the implementation uses `metric='euclidean'` on L2-normalized embedding vectors.

**Rationale.** For two L2-normalized vectors **u** and **v** (‖u‖₂ = ‖v‖₂ = 1):

```
euclidean(u, v)  = ‖u − v‖₂
                 = √(‖u‖² − 2·u·v + ‖v‖²)
                 = √(1 − 2·cosine_similarity(u,v) + 1)
                 = √(2·(1 − cosine_similarity(u,v)))
                 = √(2·cosine_distance(u,v))
```

Because the square-root transformation is strictly monotone, `euclidean` and `cosine` distance are **order-preserving on L2-normalized vectors**: for any triple (a, b, c), `euclidean(a,b) < euclidean(a,c)` iff `cosine(a,b) < cosine(a,c)`. HDBSCAN's mutual-reachability distance, MST edges, and EOM cluster extraction all operate on pairwise distance orderings, so the resulting cluster assignments are identical.

**Practical advantages of `metric='euclidean'` over `metric='cosine'` in hdbscan 0.8.33:**
- scipy's `cdist` + BLAS SGEMM is used for the pairwise matrix, which is faster and better-tested numerically than the cosine-distance path.
- Avoids a rare edge case in hdbscan's cosine path when vectors have near-zero norm (guarded in `_embed` anyway via `norms[norms == 0] = 1.0`, but belt-and-suspenders).

**What is NOT changed.** The `_embed` function still L2-normalizes every output row (line 102–104 of `cluster.py`). Removing that normalization would make `metric='euclidean'` no longer equivalent to cosine. Any future change to `_embed` that removes L2 normalization MUST also change `metric` back to `'cosine'` or re-derive the equivalence.

**Tracking.** PR #39 (issue #31). Future spec rev updates §17 to read "euclidean over L2-normalized vectors (equivalent to cosine; see amendment A2)".

### 2026-04-25 follow-on (B5): revert to `metric='cosine'` for hdbscan 0.8.33 compatibility

**Problem (B5).** In hdbscan 0.8.33, `metric='euclidean'` routes internally through `_hdbscan_prims_kdtree`, which forwards `**kwargs` (including `random_state=42`) to sklearn's `KDTree.__init__`. `KDTree` does not accept a `random_state` keyword argument, so the call raises:

```
TypeError: __init__() got an unexpected keyword argument 'random_state'
```

This broke CI (GitHub Actions run https://github.com/NikolayS/willbuy/actions/runs/24932709425) with 3 failing tests.

**Resolution.** The implementation reverts to `metric='cosine'` (spec §17 verbatim). The cosine path in hdbscan 0.8.33 routes through `_hdbscan_generic`, which does correctly accept `random_state` as a kwarg.

**Math equivalence still stands.** The rationale in A2 (euclidean on L2-normalized vectors is order-preserving equivalent to cosine) remains fully valid. The `_embed` function continues to L2-normalize every row — this is harmless under cosine and will be required if/when the implementation switches back to `metric='euclidean'`. Amendment A2 is preserved as documentation of WHY euclidean-on-L2-normalized is safe to use in the future, once the upstream hdbscan kwarg-forwarding bug is fixed.

**Regression test.** Two new tests added in `tests/test_cluster.py` guard this (B5 fix, PR #39):
- `test_hdbscan_metric_is_cosine_not_euclidean`: inspects module source to assert `metric='euclidean'` is absent from the HDBSCAN constructor call.
- `test_hdbscan_no_typeerror_with_random_state`: monkeypatches `_embed` and runs `cluster_findings` end-to-end, asserting no `TypeError` is raised with `random_state=42`.

### 2026-04-25 follow-on (B8): switch to `metric='precomputed'` for hdbscan 0.8.33 compatibility

**Root-cause chain.**

**B8a — `metric='cosine'` routes through BallTree, which rejects it.** After the B5 revert to `metric='cosine'`, hdbscan 0.8.33 (without an explicit `algorithm=` override) routes the cosine metric through `_hdbscan_prims_balltree`. BallTree's internal sklearn metric registry does not recognise `'cosine'` as a valid string identifier at the version pinned in the Docker image, raising:

```
ValueError: Unrecognized metric 'cosine'
```

**B8b — forcing `algorithm='generic'` forwards `random_state` to `cosine_distances()`, which rejects it.** The intermediate fix (`490dfac`) added `algorithm='generic'` to force routing through `_hdbscan_generic`. That path calls `sklearn.metrics.pairwise.cosine_distances(X, **kwargs)`, and `random_state=42` is one of the kwargs forwarded. `cosine_distances` does not accept `random_state`, raising:

```
TypeError: cosine_distances() got an unexpected keyword argument 'random_state'
```

**Resolution — `metric='precomputed'` bypasses all sklearn metric routing.** The final implementation (`7ebf824`) precomputes the cosine distance matrix locally:

```python
dot = embeddings @ embeddings.T          # cosine similarity (rows are L2-normalized)
np.clip(dot, -1.0, 1.0, out=dot)         # guard float overflow
dist_matrix = (1.0 - dot).astype(np.float64)
np.fill_diagonal(dist_matrix, 0.0)       # exact zero on diagonal
```

This matrix is passed to HDBSCAN as `metric='precomputed'`. With `metric='precomputed'`, hdbscan 0.8.33 calls `pairwise_distances(X, metric='precomputed')` which returns `X` immediately — no sklearn metric routing occurs, so `random_state=42` is never forwarded to any distance function that rejects it. `random_state=42` is preserved in the HDBSCAN constructor and is respected for any internal randomisation (e.g., tie-breaking in the MST).

**Why L2-normalization in `_embed` is now load-bearing.** The A2 original treated L2-normalization as a forward-compatibility guard (safe to use under euclidean, required for the euclidean-cosine equivalence). Under `metric='precomputed'`, normalization is mathematically required: the precomputed matrix is `1 - U @ V.T`, which only equals cosine distance when rows are unit-norm. Without L2-normalized rows, `1 - u·v` does not equal `cosine_distance(u, v)` and the distances would be wrong. **Any future change to `_embed` that removes L2-normalization MUST also replace the precompute block with a correct distance formula.**

**A2 math equivalence still stands.** `metric='precomputed'` with a `1 - U @ V.T` matrix IS cosine distance — it is not an approximation. The equivalence rationale in A2 (euclidean on L2-normalized vectors equals cosine) also still holds and documents a future migration path once the upstream hdbscan kwarg-forwarding bugs are fixed.

**Tracking.** PR #39 (issue #31). Future spec rev updates §17 to read "`metric='precomputed'` with manually computed cosine distance matrix (see amendment A2 follow-on B8); `random_state=42` pinned for determinism".

---

## 2026-04-24 — A3: Bun replaces pnpm + Node as the runtime and package manager

**Affects:** §4.1 (stack — `pnpm workspaces`, Node-first apps), §4.2 (build/test commands assume `pnpm`/`tsx`/`vitest` invoked through Node), §15 (CI matrix references `pnpm install --frozen-lockfile`).

**Driver:** Manager decision 2026-04-24, queued as issue #47 (post–Sprint 2). Bun ships a single binary that subsumes our package manager, test runner, transpiler, and HTTP server, removing the pnpm + Node + tsx + vitest + ts-node toolchain layering. Cold-start install and test latency on the willbuy monorepo dominate iteration time during TDD red/green cycles; Bun's install and `bun test` paths are measurably faster on the same workspace shape, and Bun.serve removes a layer of Fastify/Node abstraction for the API path. The migration was deferred (not skipped) so Sprint 2's in-flight PRs ship without rebase churn.

**Amendment.** Wherever the spec names `pnpm`, `node`, `tsx`, `vitest`, or `ts-node`, the implementation MAY substitute the Bun-native equivalent (`bun install`, `bun run`, `bun test`, `bun build`, `Bun.serve`) provided the public contracts (HTTP shape, schema validation, log format, worker queue semantics) remain spec-conformant. Lockfile is `bun.lockb` (binary). CI runners pin a Bun version via `oven-sh/setup-bun@v1` with an explicit `bun-version`. The TypeScript boundary stays the same: `zod` schemas at every external boundary, AST lint rules from §5.16 unchanged.

**What is NOT changed.** Public API shapes, JSON schemas, environment-variable names, secret references in `.env.op`, the LLMProvider adapter contract (§5.3), schema-repair retry semantics (§2 #14), Postgres schema, capture-broker socket protocol (§5.13), banner DOM-removal rules (§2 #2), report visualization spec (§5.18) — all unchanged. Migration is a runtime/toolchain swap, not a contract change.

**Constraints.** (a) Any Node-specific API used in apps (`fs.promises`, `child_process.spawn`, `node:worker_threads`) must have a verified Bun-compatible counterpart before that workspace migrates. (b) Native deps (e.g. `better-sqlite3`, `sharp`) are a known Bun pain point — audit per package; either swap to a Bun-native equivalent or pin to a version with prebuilt Bun bindings. (c) ESLint 9 flat config + the AST rules from §5.16 must continue to run under Bun (verified before the cutover PR merges). (d) `package.json` `engines.node` is dropped; `engines.bun` is added.

**Tracking.** Issue #47 (PR set on cutover). Migration ships as a single atomic PR per workspace (apps/api → apps/web → apps/capture-worker → apps/visitor-worker → apps/aggregator stays Python). Spec future rev folds Bun into §4.1.

---

## 2026-04-24 — A4: `NikolayS/sqlever` replaces the bash `migrate.sh` runner for schema migrations

**Affects:** §5.6 (`infra/migrations/*.sql` ordered by filename, applied by a thin bash runner), §15 (CI applies migrations via `bash infra/migrations/migrate.sh`).

**Driver:** Manager decision 2026-04-24, queued as issue #48 (post–Sprint 2). The bash runner that landed in PR #46 is intentionally minimal — it tracks applied migrations in `schema_migrations(version, applied_at)` and applies new files in lexical order, with no rollback, no checksum verification, no pre/post hooks, no DBLab integration, no parallel-test isolation primitives. `NikolayS/sqlever` is the in-house migration tool from the postgres-ai org and is the canonical choice across our stack; standardizing on it removes per-repo divergence and lets us share operational tooling (backfill harness, online-migration safety checks) across willbuy and the rest of postgres-ai.

**Amendment.** The migration runner referenced in §5.6 and §15 is `sqlever` (https://github.com/NikolayS/sqlever) instead of the bash `migrate.sh`. Migration filenames continue to follow the `NNNN_description.sql` pattern from PR #46 so the lexical ordering is preserved and existing migration files do not need to be rewritten or renumbered. The `schema_migrations` tracking table is replaced (or wrapped) by sqlever's own state table per its convention; PR #48 includes a one-shot data migration that reads existing `schema_migrations` rows and seeds sqlever's state so no migration is re-applied.

**What is NOT changed.** Migration content, ordering, the §17 schema, the per-migration "transactional unless explicitly opted out" guarantee from PR #46. The CLI surface for engineers shifts from `bash migrate.sh up` / `down` to the equivalent sqlever commands; that's a UX change, not a contract change.

**Constraints.** (a) sqlever must support our Postgres 16 + Supabase target (verified before cutover). (b) Local dev (Docker Compose Supabase from PR #38) and CI must use the same sqlever invocation. (c) The migration that seeds sqlever state from `schema_migrations` is itself idempotent and re-runnable.

**Tracking.** Issue #48 (PR set on cutover). Spec future rev folds sqlever into §5.6 / §15.

---

## 2026-04-24 — A5: Postgres data on a ZFS dataset with DBLab branching available alongside

**Affects:** §5.6 (Postgres deployment shape — was "Supabase Postgres on the willbuy VM"), §10 (test isolation — currently per-test schemas with cleanup), §15 (CI database setup).

**Driver:** Manager decision 2026-04-24, queued as issue #49 (post–Sprint 2). ZFS+DBLab is the postgres-ai canonical pattern: PGDATA lives on a dedicated ZFS dataset on willbuy-v01, and a DBLab instance runs nearby exposing the same dataset for thin-clone branching. Branches give us (a) per-PR ephemeral databases for integration tests against real schema state, (b) instant-restore for destructive experiments without a 30-minute pg_basebackup, (c) compression and snapshot-based backup with negligible storage overhead vs the raw 8 KB heap. Without ZFS, every "real DB integration test" is either too slow (basebackup-per-test) or unsafe (shared mutable state across tests).

**Amendment.** Postgres data on willbuy-v01 lives on a ZFS dataset (e.g. `tank/willbuy/pgdata` mounted at `/var/lib/postgresql/16/main`). A DBLab instance on the same VM (or a sibling per the postgres-ai infra pattern) exposes that dataset for thin-clone branching. Integration tests that need a real database (per §10) MAY use a DBLab branch instead of a dedicated test schema; the per-test schema pattern remains valid for unit-style tests that don't need cross-schema features.

**What is NOT changed.** Application connection strings still target a Postgres URL (the DBLab branch presents a Postgres-compatible endpoint). Schema content, migration files, and the `schema_migrations` state table (now via sqlever per A4) are unchanged. RLS, row-level security policies, and the §17 schema remain authoritative.

**Constraints.** (a) ZFS dataset properties: `recordsize=8K` (matches Postgres page size), `compression=lz4`, `atime=off`, `logbias=throughput`, `primarycache=metadata` per the postgres-ai standard ZFS-for-Postgres tuning. (b) WAL on a separate dataset with `recordsize=128K` is preferred but not blocking. (c) DBLab is not in the request hot path — it's a developer/CI primitive only; production reads/writes go straight to the primary Postgres instance. (d) Backup story: ZFS snapshots `+` `zfs send` to off-host storage, replacing whatever pg_dump cron we would otherwise run. (e) Capacity sizing on CPX21 (40 GB SSD) is tight for ZFS; the migration may bundle a VM upsize if monitoring shows the ARC + branching headroom is insufficient.

**Tracking.** Issue #49 (PR set on cutover). Spec future rev folds the ZFS + DBLab deployment into §5.6 and adds a §10 amendment around test-time branching.

---

## 2026-04-25 — A6: `packages/adapters` renamed to `packages/llm-adapter`; forbidden identifiers inlined in `eslint-rule.js`

**Affects:** §2 #12 (`packages/adapters/**` AST scope, `packages/adapters/forbidden-keys.ts` location), §6 (`packages/adapters/forbidden-keys.ts` reference).

**Driver:** Sprint 1 implementation simplification — a single workspace with a single `eslint-rule.js` is shorter than a separate `forbidden-keys.ts` module that the rule has to import. Spec was written before the simpler shape was clear.

**Amendment.** Wherever the spec says `packages/adapters/`, read `packages/llm-adapter/`. The forbidden identifier list lives inline in `packages/llm-adapter/eslint-rule.js` (the `FORBIDDEN` Set constant) instead of a separate `forbidden-keys.ts` file. AST lint scope is unchanged: still scans all TS files in `packages/llm-adapter/**` for forbidden identifier usage as keys, properties, parameters, and imports.

**What is NOT changed.** The 9-identifier list itself (now correct after this PR per BD-1 fix: `conversation_id`, `session_id`, `thread_id`, `previous_response_id`, `cached_prompt_id`, `parent_message_id`, `context_id`, `assistant_id`, `run_id`), the AST-vs-grep authoritative ordering, the CI failure semantics on lint hit, the LLMProvider interface contract.

**Constraints.** Adding more provider adapters in the future (e.g. a hypothetical OpenAI HTTP adapter) MUST live in `packages/llm-adapter/` and inherit the same `eslint-rule.js` Set. If a separate provider package is ever needed, the `eslint-rule.js` Set should be extracted to a shared module first.

**Tracking.** PR #N (set on merge), issue #20.
