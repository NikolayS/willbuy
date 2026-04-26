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

### 2026-04-25 follow-on (Bun 1.3.5 reality): cutover refinements from PR #52

**Driver.** PR #52 (issue #47) cut over the monorepo. Three reality-vs-spec gaps surfaced during implementation; documenting them here so the spec future rev folds the corrected text into §4.1, not the original A3 wording.

**1. Lockfile format: `bun.lock` (text), not `bun.lockb` (binary).** A3 said the lockfile becomes `bun.lockb` (binary). That was true for Bun 1.0–1.1; Bun 1.2+ defaults to a text-format `bun.lock` (TOML-shaped, diffable in PRs, mergeable without binary tooling). Both `bun.lock` and `bun.lockb` are accepted by `bun install --frozen-lockfile` — the runtime decides based on which file is present. The willbuy repo ships `bun.lock` (Bun 1.3.5 was the version pinned in CI at cutover). Reviewer-friendly text diffs are an unambiguous improvement over a binary blob, so this is a strict upgrade over the A3 wording. Any future Bun-version pin bump that flips the default back to binary MUST update both this paragraph and the `bun.lock` → `bun.lockb` rename in the same PR.

**2. Test runner: vitest is kept; `bun test` is not adopted at cutover.** A3 named `bun test` as the substitution target for vitest. In practice, `bun test` (as of Bun 1.3.5) is materially incompatible with the existing test suite on three axes: (a) no built-in jsdom environment (the `apps/web` tests need it for `@testing-library/react`), (b) a different esbuild-vs-Bun-transpiler JSX transform configuration surface (the `vitest.config.ts` `esbuild: { jsx: 'automatic' }` knob has no `bun test` equivalent that produces identical bytecode), (c) `beforeAll`/`afterAll` scoping semantics differ subtly from vitest's at the suite-vs-file level (capture-broker's per-test socket teardown depends on vitest's behavior). Rewriting 225 tests during a toolchain migration is the wrong shape of change — too much surface area for a "no contract change" PR. Vitest stays, invoked via `bun run test`. The migration is therefore **package-manager + script-runner + TypeScript-execution swap only**; the test framework is unchanged. A future migration to `bun test` (or whatever passes the vitest-compat bar at that point) is a separate issue/PR with its own red→green test-rewrite history. The A3 phrase "Bun-native equivalent (`bun install`, `bun run`, `bun test`, ...)" should be read as MAY-not-MUST; #52 exercises the MAY for `bun install` and `bun run` and explicitly defers `bun test`.

**3. ESLint 9 flat config + §5.16 AST rules: verified green under `bunx eslint`.** A3 constraint (c) required the AST rules from §5.16 (`willbuy/no-sandbox-flag`, `willbuy/no-reserved-llm-identifiers`, `react/no-danger`) to continue running under Bun. PR #52 verified this end-to-end: `bunx eslint .` produces zero diagnostics on the clean tree, and the three test suites that exercise the rules via fixture inputs (`tests/lint-rules.test.ts`, `apps/web/test/lint-scoping.test.ts`, `packages/llm-adapter/test/lint-rule.test.ts`) all pass after migrating their `spawnSync('pnpm', ['exec', 'eslint', ...])` calls to `spawnSync('bunx', ['eslint', ...])`. typescript-eslint, eslint-plugin-react, and the custom willbuy plugins all load identically under Bun's Node-API runtime.

**4. CI workspace-bin invocation pattern.** Bun's `bun run --filter <ws-name> <name>` interprets the trailing `<name>` as a package SCRIPT, not as a binary on the workspace's `PATH` — so it has no 1:1 equivalent of pnpm's `pnpm --filter NAME exec <bin>`. The CI step that installs Playwright browsers therefore uses `cd apps/capture-worker && bunx playwright install --with-deps chromium` instead. This is documented inline in `.github/workflows/ci.yml` so future engineers don't re-introduce the broken `bun run --filter ... playwright` form.

**Tracking.** PR #52 (issue #47).

---

## 2026-04-24 — A4: `NikolayS/sqlever` replaces the bash `migrate.sh` runner for schema migrations

**Affects:** §5.6 (`infra/migrations/*.sql` ordered by filename, applied by a thin bash runner), §15 (CI applies migrations via `bash infra/migrations/migrate.sh`).

**Driver:** Manager decision 2026-04-24, queued as issue #48 (post–Sprint 2). The bash runner that landed in PR #46 is intentionally minimal — it tracks applied migrations in `schema_migrations(version, applied_at)` and applies new files in lexical order, with no rollback, no checksum verification, no pre/post hooks, no DBLab integration, no parallel-test isolation primitives. `NikolayS/sqlever` is the in-house migration tool from the postgres-ai org and is the canonical choice across our stack; standardizing on it removes per-repo divergence and lets us share operational tooling (backfill harness, online-migration safety checks) across willbuy and the rest of postgres-ai.

**Amendment.** The migration runner referenced in §5.6 and §15 is `sqlever` (https://github.com/NikolayS/sqlever) instead of the bash `migrate.sh`. Migration filenames continue to follow the `NNNN_description.sql` pattern from PR #46 so the lexical ordering is preserved and existing migration files do not need to be rewritten or renumbered. The `schema_migrations` tracking table is replaced (or wrapped) by sqlever's own state table per its convention; PR #48 includes a one-shot data migration that reads existing `schema_migrations` rows and seeds sqlever's state so no migration is re-applied.

**What is NOT changed.** Migration content, ordering, the §17 schema, the per-migration "transactional unless explicitly opted out" guarantee from PR #46. The CLI surface for engineers shifts from `bash migrate.sh up` / `down` to the equivalent sqlever commands; that's a UX change, not a contract change.

**Constraints.** (a) sqlever must support our Postgres 16 + Supabase target (verified before cutover). (b) Local dev (Docker Compose Supabase from PR #38) and CI must use the same sqlever invocation. (c) The migration that seeds sqlever state from `schema_migrations` is itself idempotent and re-runnable.

**Tracking.** Issue #48 (PR set on cutover). Spec future rev folds sqlever into §5.6 / §15.

### 2026-04-25 follow-on (cutover details, PR #48):

**sqlever version pinned:** `0.3.0` (installed as a workspace devDependency in `package.json`; resolved via `bunx sqlever` in CI and local dev; pinned exact version, not a range).

**State-table approach.** The A4 spec says "the `schema_migrations` tracking table is replaced (or wrapped)". In practice:
- sqlever uses the Sqitch-compatible `sqitch.*` tracking schema (`sqitch.changes`, `sqitch.events`, `sqitch.projects` — all created idempotently on first deploy).
- The old `_migrations(filename, checksum, applied_at)` table is **kept** as a backward-compat shadow. Each deploy script in `infra/sqlever/deploy/` appends `INSERT INTO _migrations ... ON CONFLICT DO NOTHING` inside its `BEGIN`/`COMMIT` block. This means `_migrations` stays in sync with sqlever state, existing test assertions that count `_migrations` rows keep passing, and DBA queries that inspect `_migrations` continue to work.
- `infra/migrations/0014_seed_sqlever_state.sql` is a tombstone/comment file added to keep the file count in `infra/migrations/` consistent with the `_migrations` row count (test assertions count `.sql` files in that directory). Its corresponding deploy script (`infra/sqlever/deploy/0014_seed_sqlever_state.sql`) only writes the `_migrations` row.
- For databases previously managed by the old bash runner: running `bun run migrate` (sqlever deploy) on them is safe — all 15 deploy scripts use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` guards, so they are re-runnable. sqlever's `sqitch.*` tables are created fresh and seeded by the deploy run itself.

**sqlever project layout:**
```
infra/sqlever/
  sqitch.conf        — engine=pg, plan_file=sqitch.plan, top_dir=.
  sqitch.plan        — 15 changes (0000_init … 0014_seed_sqlever_state), linear dep chain
  deploy/            — 15 deploy scripts; each wraps original SQL + _migrations INSERT
  revert/            — empty (revert scripts not provided; §5.6 "forward-only" policy)
  verify/            — empty (verify scripts not provided at this sprint)
```

**CI invocation.** `scripts/migrate.sh` is updated to call:
```
bunx sqlever deploy --top-dir infra/sqlever/ --db-uri $DATABASE_URL --no-tui
```
`bun install --frozen-lockfile` in CI installs sqlever from the lockfile. No separate install step needed. The `SQLEVER_TOP_DIR` env var overrides `--top-dir` for test isolation (temp projects in `migrations.test.ts`).

**Delta from A4 original wording:**
- A4 says "`schema_migrations` tracking table is replaced"; actual table name in the codebase was `_migrations`, not `schema_migrations`. The shadow table is kept (not replaced) as described above.
- A4 says "one-shot data migration that reads existing `schema_migrations` rows and seeds sqlever's state". The actual approach is simpler: since all deploy scripts are idempotent, a fresh `sqlever deploy` on an existing database just re-applies the DDL (no-op due to `IF NOT EXISTS`) and fills `sqitch.*` tables. A separate seeding migration is not needed because sqlever's `deploy` self-seeds its state table on first run.

**Test evidence:** `bun test tests/migrations.test.ts` → 3/3 pass; `bun test tests/migrations.schema.test.ts` → 81/81 pass. Tests updated to call sqlever via `scripts/migrate.sh` (no MIGRATIONS_DIR; SQLEVER_TOP_DIR for temp project injection in the failing-migration rollback test).

---

## 2026-04-24 — A5: Postgres data on a ZFS dataset with DBLab branching available alongside

**Affects:** §5.6 (Postgres deployment shape — was "Supabase Postgres on the willbuy VM"), §10 (test isolation — currently per-test schemas with cleanup), §15 (CI database setup).

**Driver:** Manager decision 2026-04-24, queued as issue #49 (post–Sprint 2). ZFS+DBLab is the postgres-ai canonical pattern: PGDATA lives on a dedicated ZFS dataset on willbuy-v01, and a DBLab instance runs nearby exposing the same dataset for thin-clone branching. Branches give us (a) per-PR ephemeral databases for integration tests against real schema state, (b) instant-restore for destructive experiments without a 30-minute pg_basebackup, (c) compression and snapshot-based backup with negligible storage overhead vs the raw 8 KB heap. Without ZFS, every "real DB integration test" is either too slow (basebackup-per-test) or unsafe (shared mutable state across tests).

**Amendment.** Postgres data on willbuy-v01 lives on a ZFS dataset (e.g. `tank/willbuy/pgdata` mounted at `/var/lib/postgresql/16/main`). A DBLab instance on the same VM (or a sibling per the postgres-ai infra pattern) exposes that dataset for thin-clone branching. Integration tests that need a real database (per §10) MAY use a DBLab branch instead of a dedicated test schema; the per-test schema pattern remains valid for unit-style tests that don't need cross-schema features.

**What is NOT changed.** Application connection strings still target a Postgres URL (the DBLab branch presents a Postgres-compatible endpoint). Schema content, migration files, and the `schema_migrations` state table (now via sqlever per A4) are unchanged. RLS, row-level security policies, and the §17 schema remain authoritative.

**Constraints.** (a) ZFS dataset properties: `recordsize=8K` (matches Postgres page size), `compression=lz4`, `atime=off`, `logbias=throughput`, `primarycache=metadata` per the postgres-ai standard ZFS-for-Postgres tuning. (b) WAL on a separate dataset with `recordsize=128K` is preferred but not blocking. (c) DBLab is not in the request hot path — it's a developer/CI primitive only; production reads/writes go straight to the primary Postgres instance. (d) Backup story: ZFS snapshots `+` `zfs send` to off-host storage, replacing whatever pg_dump cron we would otherwise run. (e) Capacity sizing on CPX21 (80 GB SSD) is acceptable for ZFS at v0.1 (30 GB loopback pool + ~50 GB for OS + Docker layers); the migration may bundle a VM upsize if monitoring shows the ARC + branching headroom is insufficient. [Corrected from "40 GB" — CPX21 is 80 GB NVMe; the 40 GB figure was a CPX11 draft error. See follow-on below and PR #65 L-1 fix.]

**Tracking.** Issue #49 (PR set on cutover). Spec future rev folds the ZFS + DBLab deployment into §5.6 and adds a §10 amendment around test-time branching.

### **2026-04-25 follow-on (provisioning details):**

**ZFS pool and dataset structure (willbuy-v01, Hetzner CPX21, Ubuntu 24.04):**

```
ZFS pool name:  tank
Backed by:      /var/lib/zfs-tank/tank.img  (sparse loopback, up to 30 GB)
                v0.2: replace with Hetzner Volume or dedicated disk

Datasets:
  tank/willbuy/pgdata
    mountpoint:     /var/lib/postgresql/data
    recordsize:     8K        (matches Postgres 8 KB heap page)
    compression:    lz4
    atime:          off
    logbias:        throughput
    primarycache:   metadata

  tank/willbuy/pgwal
    mountpoint:     /var/lib/postgresql/wal
    recordsize:     128K      (matches WAL segment write pattern)
    compression:    lz4
    atime:          off
    logbias:        throughput
    primarycache:   all       (WAL reads benefit from full ARC caching)
```

**WAL placement decision:** Separate `tank/willbuy/pgwal` dataset is created by default (`CREATE_WAL_DATASET=yes`). This is the preferred layout per constraint (b) of A5. The WAL bind-mount (`/var/lib/postgresql/wal`) must be mapped into the Supabase `db` container via the compose override if a non-default `wal_level` / `archive_command` is used. For the v0.1 default (WAL inside PGDATA), no additional compose change is required.

**VM upsize decision:** CPX21 has 80 GB SSD (README table corrected). 30 GB loopback pool + ~50 GB remaining for OS + Docker layers is acceptable for v0.1. No upsize is needed before PR #49 merge. Upsize to CPX31 (8 GB RAM) and attach a Hetzner Volume for v0.2/launch when production data volume grows.

**Migration strategy chosen:** shutdown-rsync (stop `docker compose down`, rsync Docker volume `_data` → ZFS mount, write compose override, bring stack back up). Rationale: no production data exists at Sprint 2; rsync is instantaneous. For production migrations (v0.2+), switch to `pg_basebackup`-based hot migration.

**DBLab configuration:**
- Config file: `infra/dblab/dblab.yml` (committed; token placeholder replaced at deploy time).
- Physical mode with `pg_basebackup` for initial data provisioning.
- Snapshot schedule: every 6 hours; retention: 4 snapshots.
- Clone ports: 6000–6019 (localhost only).
- Idle clone TTL: 240 minutes.

**Scripts shipped in this PR:**
- `infra/zfs/setup-zfs-pgdata.sh` — idempotent ZFS pool + dataset creation.
- `infra/zfs/migrate-pgdata.sh`   — PGDATA migration + compose override.
- `infra/dblab/install-dblab.sh`  — DBLab Engine Docker install + CLI init.
- `infra/dblab/dblab.yml`         — DBLab server configuration template.

---

## 2026-04-25 — A6: `packages/adapters` renamed to `packages/llm-adapter`; forbidden identifiers inlined in `eslint-rule.js`

**Affects:** §2 #12 (`packages/adapters/**` AST scope, `packages/adapters/forbidden-keys.ts` location), §6 (`packages/adapters/forbidden-keys.ts` reference).

**Driver:** Sprint 1 implementation simplification — a single workspace with a single `eslint-rule.js` is shorter than a separate `forbidden-keys.ts` module that the rule has to import. Spec was written before the simpler shape was clear.

**Amendment.** Wherever the spec says `packages/adapters/`, read `packages/llm-adapter/`. The forbidden identifier list lives inline in `packages/llm-adapter/eslint-rule.js` (the `FORBIDDEN` Set constant) instead of a separate `forbidden-keys.ts` file. AST lint scope is unchanged: still scans all TS files in `packages/llm-adapter/**` for forbidden identifier usage as keys, properties, parameters, and imports.

**What is NOT changed.** The 9-identifier list itself (now correct after this PR per BD-1 fix: `conversation_id`, `session_id`, `thread_id`, `previous_response_id`, `cached_prompt_id`, `parent_message_id`, `context_id`, `assistant_id`, `run_id`), the AST-vs-grep authoritative ordering, the CI failure semantics on lint hit, the LLMProvider interface contract.

**Constraints.** Adding more provider adapters in the future (e.g. a hypothetical OpenAI HTTP adapter) MUST live in `packages/llm-adapter/` and inherit the same `eslint-rule.js` Set. If a separate provider package is ever needed, the `eslint-rule.js` Set should be extracted to a shared module first.

**Tracking.** PR #N (set on merge), issue #20.

### **2026-04-25 follow-on (A6 method-name addendum):**

The spec §2 #12 sentence that defines the LLMProvider contract reads `LLMProvider.complete(request)`. The merged Sprint 1 implementation (PR #19) named the method **`chat(opts)`** instead, with the same typed-request contract. Sprint 2 confirmed this name everywhere via §5.16 AST lint. The rename is deliberate: the method's job is a chat-completion call (input messages + output assistant message), and `chat` is the verb the rest of our code, the Anthropic Messages API, and the Vercel AI SDK all use. `complete` was a Sprint 0 placeholder.

**Implementation:** `packages/llm-adapter/src/index.ts:LLMProvider.chat(opts: LLMChatOptions)`. The opts type is the typed request shape §2 #12 specifies. No semantic change.

**What is NOT changed.** The forbidden-identifiers list (still 9 entries), the §2 #14 schema-repair retry semantics, the §2 #15 idempotency contract, the §5.15 logical-request-key formula, the §5.16 AST lint scope.

**Tracking.** Sprint 1 PR #19 (the original rename), this amendment for retroactive recording.

---

## 2026-04-25 — A7: credit-pack tier names (`starter` / `growth` / `scale`) standardize §5.6's three pack tiers

**Affects:** §5.6 (Credit-pack tiers — spec lists three tiers by dollar amount + credit count, no names).

**Driver:** PR #71 / issue #36. The §5.6 spec wording is `Credit-pack tiers: $29 (1,000 credits), $99 (4,000 credits), $299 (15,000 credits)`. Stripe Checkout requires named price IDs and the dashboard UI surfaces a tier name to the buyer (e.g. on the BuyCredits CTA, in Stripe receipts, in our `credit_ledger.kind='top_up'` reconciliation logs). Implementation chose `starter` / `growth` / `scale` to match common SaaS pricing-tier conventions and to leave room for future tiers (`team`, `enterprise`).

**Amendment.** The three v0.1 credit packs from §5.6 are canonically identified as:

| `pack_id`  | USD     | Credits (`pack.cents` field) | Stripe price-id env var      |
| ---------- | ------- | ---------------------------- | ---------------------------- |
| `starter`  | $29     | 2900                         | `STRIPE_PRICE_ID_STARTER`    |
| `growth`   | $99     | 9900                         | `STRIPE_PRICE_ID_GROWTH`     |
| `scale`    | $299    | 29900                        | `STRIPE_PRICE_ID_SCALE`      |

The spec's `(1,000 credits)` / `(4,000 credits)` / `(15,000 credits)` parenthetical was a marketing-display label (1 display-credit ≈ 2.9¢ at starter, ≈ 2.475¢ at growth, ≈ 2¢ at scale — bulk discount on display credits, not on real spend). The `credit_ledger.cents` column is dollar-cents 1:1 with the spend kind (5¢/visit per §5.5), so the ledger receives `pack.cents` (= dollar-cents from Stripe) directly. The display-credit count (1000/4000/15000) is a UI label only; it does NOT flow into the ledger.

**What is NOT changed.** Pricing in USD ($29/$99/$299), the `credit_ledger` schema, idempotency on `event.id` per §16, the §5.5 spend-cap semantics, the §5.6 cap-warning email rule.

**Constraints.** (a) Three names are stable for v0.1; new tiers go through a fresh amendment + Stripe dashboard update. (b) The display-credit-count label is the only place the user sees a non-monetary number — keep that math consistent in `BuyCredits.tsx` (currently a known minor display bug per issue #73). (c) Stripe price IDs are environment-specific (test-mode vs live-mode); `STRIPE_PRICE_ID_*` env vars are sourced via `op inject` from the `willbuy` 1Password vault.

**Tracking.** PR #71 (issue #36 close).

---

## 2026-04-26 — A8: CSP `style-src` includes `'unsafe-inline'` (Recharts compatibility)

**Affects:** §5.10 (Content-Security-Policy on `/dashboard/*` and `/r/*`).

**Driver:** Issue #133. The strict CSP from PR #13 set `style-src 'self'` (no `'unsafe-inline'`). Recharts' `<ResponsiveContainer>` emits inline `style="width:100%;height:256px"` attributes for chart dimensions; the browser silently rejected them, the container's computed height collapsed to 0px, and Recharts drew zero SVG. Result: all 7 §5.18 chart sections (paired-dots, both histograms, next-actions, tier-picked, theme-board, persona grid) rendered as empty divs in production.

**Amendment.** The CSP `style-src` directive becomes `style-src 'self' 'unsafe-inline'` (was `style-src 'self'`). Verbatim CSP string after this amendment:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'
```

**Rationale.** §5.10 does not mandate strict `style-src`; the `script-src` strictness is what defends against XSS. Inline styles cannot execute JavaScript. The conventional Next.js + Recharts pattern relaxes `style-src` and keeps `script-src` strict — that is what we adopt. The `dangerouslySetInnerHTML` lint (`react/no-danger` in `eslint.config.mjs`) independently forbids inline-JS injection paths, so this CSP relaxation does not regress the §5.10 XSS posture.

**What is NOT changed.**

- `script-src 'self'` (the XSS-relevant directive) — still strict, no `'unsafe-inline'`, no `'unsafe-eval'`.
- `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `require-trusted-types-for 'script'` — unchanged.
- The middleware matcher (`/dashboard/:path*`, `/r/:path*`) — unchanged. Marketing routes are still out of scope per the §5.10 scope-narrowing comment in `apps/web/middleware.ts`.
- Permissions-Policy, X-Content-Type-Options, Referrer-Policy headers — unchanged.
- The `react/no-danger` lint rule in `eslint.config.mjs` — still `error`. It still forbids `dangerouslySetInnerHTML` in `apps/web/**`.

**Constraints.**

- (a) Any future inline-style additions must NOT involve untrusted-data interpolation. Server-rendered styles (Recharts dimensions, Tailwind-generated class output, etc.) only. If a future feature needs to interpolate user-supplied values into a style attribute, that feature MUST sanitize at the boundary or use a class-lookup pattern (cf. PR #128 / issue #111 for the progress-bar precedent).
- (b) `script-src` MUST stay strict. If a future change adds `'unsafe-inline'` or `'unsafe-eval'` to `script-src`, that requires its own amendment (and a strong reason — adding `'unsafe-inline'` to `script-src` defeats §5.10 entirely).
- (c) The middleware test (`apps/web/test/middleware.test.ts`) asserts both invariants: `style-src` contains `'unsafe-inline'` AND `script-src` does NOT. Both assertions guard the directive split.

**Tracking.** PR #N (set on merge), issue #133.

---

## 2026-04-25 — A9: CSP `script-src` carries a per-request nonce + `'strict-dynamic'` (Next.js 14 App Router hydration)

**Affects:** §5.10 (Content-Security-Policy on `/dashboard/*` and `/r/*`); follows on amendment A8 which relaxed `style-src` only.

**Driver:** Issue #135 — CSP blocks Next 14 inline bootstrap scripts, breaks all client hydration. The strict `script-src 'self'` shipped in PR #13 silently blocked the inline `<script>` tags Next.js 14 App Router emits during SSR (the `(self.__next_f = self.__next_f || []).push([1, "..."])` payloads that deliver the React Server Components flight tree to the client). Without those inline scripts, `window.__next_f.length === 0`, React never receives the RSC tree, no fiber attaches to any DOM node, no client component effect runs, and Recharts' `ResponsiveContainer` never measures + draws — the §5.18 chart container divs SSR with proper dimensions but render zero SVG. This blocked the launch dogfood (issue #86) because the public report `/r/test-fixture` was the demo target.

`'unsafe-inline'` is FORBIDDEN for `script-src` per §5.10 (it would defeat the XSS defence entirely; cf. amendment A8 constraint (b) and amendment A8 "What is NOT changed" line 1). The correct fix is the canonical Next.js 14 nonce pattern.

**Amendment.** The CSP `script-src` directive becomes `script-src 'self' 'nonce-<value>' 'strict-dynamic'` (was `script-src 'self'`). The `<value>` is a per-request nonce: 16 random bytes produced by `crypto.getRandomValues` (Edge runtime) and base64-encoded. The same nonce is forwarded on the request via the `x-nonce` header (the `NextResponse.next({ request: { headers } })` mutation), which Next.js 14's RSC renderer reads and stamps on its own inline bootstrap `<script>` tags. The CSP header is therefore non-deterministic across requests; `apps/web/test/middleware.test.ts` asserts directive shape (presence of `'self'`, `'nonce-...'`, `'strict-dynamic'`; absence of `'unsafe-inline'` / `'unsafe-eval'`) instead of string-equality on the full CSP.

`'strict-dynamic'` allows the nonce'd bootstrap scripts to authorize their chunk `<script src=".../_next/static/chunks/...">` loads transitively, so newer browsers (CSP3) ignore the `'self'` whitelist. `'self'` is kept as a defensive fallback for older browsers that ignore `'strict-dynamic'`.

Verbatim CSP string template after this amendment (where `<NONCE>` is the 24-character base64 of 16 random bytes, distinct per request):

```
default-src 'self'; script-src 'self' 'nonce-<NONCE>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'
```

**What is NOT changed.**

- The forbidden `'unsafe-inline'` / `'unsafe-eval'` rule for `script-src` — still forbidden, asserted in `apps/web/test/middleware.test.ts`. The nonce + `'strict-dynamic'` pattern is materially different from `'unsafe-inline'`: an attacker who injects a bare `<script>foo()</script>` cannot guess the per-request nonce, so the script does not execute. `'unsafe-inline'` would let any injected inline script run.
- `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `require-trusted-types-for 'script'` — unchanged.
- `style-src 'self' 'unsafe-inline'` (amendment A8) — unchanged.
- The middleware matcher (`/dashboard/:path*`, `/r/:path*`) — unchanged.
- Permissions-Policy, X-Content-Type-Options, Referrer-Policy headers — unchanged.
- The `react/no-danger` lint rule in `eslint.config.mjs` — still `error`.
- The `CSP` module-scope constant in `apps/web/middleware.ts` is replaced by a `buildCsp(nonce)` helper because the directive string is now request-scoped. The string-equality test from before A8 is replaced by per-directive shape assertions (extracted via a small `getCspDirective` helper in the test file).

**Constraints.**

- (a) Nonce entropy: at least 16 bytes (128 bits) per CSP3 SHOULD; the implementation uses exactly 16 bytes via `crypto.getRandomValues`. Any future change MUST keep the entropy at or above 128 bits.
- (b) The nonce MUST be generated per request inside the middleware function, never at module scope (which would memoize a single nonce across the lifetime of the Edge worker, defeating the protection). Test `successive requests get distinct nonces (no module-scope memoization)` guards this.
- (c) The nonce MUST be forwarded on the *request* headers via `NextResponse.next({ request: { headers } })`, not just on the response. The Next.js 14 internal RSC renderer reads the request-side `x-nonce` header to stamp its own inline scripts. Setting it only on the response would leave the rendered HTML un-nonced and hydration would still fail.
- (d) Adding any third-party script source (analytics, tag manager, etc.) is OUT OF SCOPE for this amendment. If it ever becomes necessary, prefer continuing to rely on `'strict-dynamic'` (load the third-party loader from a nonce'd bootstrap) over re-introducing host-based whitelisting, which `'strict-dynamic'` makes ineffective in CSP3.
- (e) CSP `report-uri` / `report-to` are NOT added in this PR. Reporting can be added in a follow-on amendment if needed; it is unrelated to the hydration fix.
- (f) The middleware test (`apps/web/test/middleware.test.ts`) asserts: `script-src` contains `'self'` + `'nonce-<value>'` + `'strict-dynamic'`; `script-src` does NOT contain `'unsafe-inline'` / `'unsafe-eval'`; `x-nonce` is exposed on the response; `x-nonce` is forwarded on the request via the Next 14 `x-middleware-request-x-nonce` shadow header; successive requests get distinct nonces; nonce is URL-safe-base64. All six assertions guard the A9 invariants.

**Tracking.** PR #N (set on merge), issue #135. Future spec rev folds nonce + `'strict-dynamic'` into §5.10 directly and drops the verbatim string-form there (now request-scoped).

---

## 2026-04-26 — A10: HDBSCAN small-dataset fallback — single catch-all cluster when density pass finds nothing

**Affects:** §17 (HDBSCAN params: clustering output), §5.7 (clustering algorithm).

**Driver:** Issue #180 (PR #181). Spec §17 defines HDBSCAN with `min_cluster_size=3`. With sparse finding strings from a small study (< ~50 visits), the density-based pass labels all points as noise and returns an empty label array. In the Sprint 6 dogfood (n=10 visits), `unanswered_blockers` produced zero clusters despite ~30 total strings, leaving the theme board section entirely empty on the report.

**Amendment.** When `cluster_findings()` receives `len(normalized) >= 3` strings but HDBSCAN assigns every point to noise (i.e. no clusters in the output), return **one catch-all cluster** containing all normalized strings with `id=0`. When `len(normalized) < 3`, the existing early bail (`return []`) still applies — HDBSCAN cannot form a cluster regardless, and returning a trivial singleton "cluster" adds no signal.

This fallback fires only for small datasets; large studies with sufficient density pass through the normal HDBSCAN path and are unaffected.

**What is NOT changed.** HDBSCAN parameters (`min_cluster_size=3`, `min_samples=3`, `cluster_selection_method='eom'`, `approx_min_span_tree=False`, `random_state=42`, `metric='precomputed'`), the L2-normalization in `_embed`, the normalize-dedupe-lex-sort pipeline, and the determinism guarantee within a pinned image digest — all unchanged. The spec §17 statement "Noise points (HDBSCAN label == -1) are excluded" still applies to the normal path; the fallback fires only when the normal path produces zero clusters.

**Regression test.** `test_cluster_findings_small_dataset_fallback` in `apps/aggregator/tests/test_cluster.py` monkeypatches `_embed` with random-spread vectors that HDBSCAN cannot cluster and asserts one catch-all cluster is returned.

**Tracking.** PR #181 (issue #180). Future spec rev folds fallback behavior into §17 / §5.7.
