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
