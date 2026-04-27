# Engineering principles for willbuy.dev

This file is read by every Claude Code agent working in this repo. Follow it.

## Shared rules (postgres-ai family)

This repo follows the conventions at **https://gitlab.com/postgres-ai/rules/-/tree/main/rules** — pull latest before starting work. Sibling repos using the same baseline: `pg_ash`, `rpg`, `pgque`. Below extends that baseline for willbuy specifics; on conflict the willbuy rules in this file win.

## Naming

`willbuy` is always lowercase (schema, package names, CLI, repo, prose, headings). The product is `willbuy.dev`. Mirrors PostgreSQL ecosystem convention (pgmq, pg_cron, pg_ash, pgque).

## The spec is authoritative

The single source of truth is `.samo/spec/willbuy/SPEC.md`. Read the relevant section before you start. If reality forces a deviation from the spec, do **not** silently change behavior — record the deviation in `.samo/spec/willbuy/SPEC.willbuy.amendments.md` (create if missing, append-only, dated) and link it from the PR description.

## Public repo discipline

This repository is **public on github.com**. Treat every commit as published.

- No secrets, tokens, API keys, hostnames-with-IPs, or VM-specific identifiers in any committed file. The `.gitignore` blocks `.env`, `*secrets*`, `*.key`, `*.pem` — explicit allow-list entries exist for the two safe template files. Do not add new bypasses.
- Real values live in 1Password (vault `willbuy`); local materialization via `op inject -i .env.op -o .env`; server materialization via `op run --env-file=.env.op -- scripts/push-secrets.sh`.
- IP addresses, server names with their public IPs, tunnel tokens, OAuth artifacts: never in git. If you need a host reference, look it up via `hcloud` API at runtime (see `scripts/push-secrets.sh` for the pattern).
- Architectural notes about how local-CLI subprocesses provide LLM access can stay generic ("LLMProvider implementation X uses a subprocess to a local CLI"). Specifics about subscription auth, OAuth-on-VM, or anything that leaks a cost-side advantage stay out of the repo. If you need to document it, put it in 1Password as a Secure Note.

## TDD: red → green → refactor

For every code change that touches behavior:

1. **Red:** write the failing test first. Commit it (or include in the PR with a clearly-failing-then-passing history). The test names what the change is supposed to do.
2. **Green:** the simplest code that makes the test pass. Resist generalizing.
3. **Refactor:** if the green code is ugly, refactor with the test as your safety net. Tests must stay green.

PRs that introduce behavior without a test will be sent back. PRs that add a test that was always passing (no red commit, or no diff that makes the test pass) will also be sent back.

## Coding rules

- **TypeScript everywhere** except the aggregator (Python for the pinned scientific stack per spec §17). Strict mode on; `noUncheckedIndexedAccess` on; `exactOptionalPropertyTypes` on.
- **zod schemas** for every external input (HTTP requests, LLM outputs, env vars). Parse at the boundary; pass typed data inward.
- **No premature abstraction.** Three similar lines is fine. Don't introduce a generic helper for two callers. Don't introduce a plugin system for one impl.
- **No comments unless WHY is non-obvious.** Don't write `// fetches the user`. Do write `// CF query-strip means we deliberately accept token in path here; see spec §5.12`.
- **Don't add error handling for impossible cases.** If a caller is internal and a value is guaranteed non-null by upstream code, don't add `if (x == null) throw` defensively.
- **Don't add features the issue didn't ask for.** Bug fixes don't need surrounding cleanup. One-shot operations don't need helpers. No backwards-compat shims when you can just change the caller.
- **No `--no-sandbox` for Chromium.** Ever. There's a CI grep-lint enforcing this.
- **No reserved identifiers at LLM adapter call sites or in adapter type definitions.** Spec §2 #12 lists them; an AST lint enforces. If your code grep-matches `conversation_id|session_id|thread_id|previous_response_id|cached_prompt_id|parent_message_id|context_id|assistant_id|run_id` near an LLM call, you'll fail CI — by design, to preserve the fresh-context guarantee.
- **All LLM calls go through `LLMProvider` (chat) — only.** No direct subprocess to a CLI from worker code; no direct HTTP to a provider. The adapter is the seam where capability flags, idempotency keys, prompt-caching prefix isolation, and spend ledger writes happen. Bypassing the adapter breaks every guarantee in the spec at once.
- **Embeddings are local in-process** via `fastembed` (`BAAI/bge-small-en-v1.5`). No external embedding provider, no API key, no adapter. Spec §17.

## The PR contract

Every PR you open must include:

1. **Linked issue** in the body (`Closes #N`).
2. **Test evidence**:
   - Unit/integration test commits that demonstrate red → green.
   - For UI/integration changes: a paste of the actual command + output that exercised the feature, with the relevant log lines or a screenshot description (alt text is fine).
3. **Spec link**: which spec section your work satisfies (e.g. "Implements spec §2 #16 + §5.5").
4. **Public-repo audit**: confirm no secrets, IPs, or secret-sauce leaks in the diff. Re-grep your commits before opening the PR.
5. **CI green** before requesting review.

## Review will be applied

Every PR gets reviewed by the REV tool (https://gitlab.com/postgres-ai/rev/) — `/review-mr <PR-URL>` — before merge. REV is designed for GitLab MRs but works on GitHub PRs too. Both blocking and non-blocking findings are surfaced. SOC2-flavored findings can be ignored on this repo (we are not SOC2-scoped at v0.1; this is an explicit exception). All other blocking findings must be addressed before merge. **Never merge without explicit approval from the manager (or project owner).**

## Commit message convention

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`, `ci:`, `build:`, `perf:`, `style:`. Optional scope in parens.

```
<type>(<scope>): <imperative summary under 60 chars>

<optional body explaining WHY, wrapping at 72 chars>
<optional footer with refs>

Closes #<issue-number>
```

Scopes seen so far: `monorepo`, `shared`, `llm-adapter`, `api`, `web`, `capture-worker`, `visitor-worker`, `aggregator`, `infra`, `spec`. New scopes appear naturally.

Co-Authored-By footer is welcome but not required.

### Git safety

- **Never amend** — create a new commit. Amending breaks reviewers' diff state and confuses CI.
- **Never force-push** unless explicitly confirmed. If you must (e.g. rebase to fix a merge conflict), use `--force-with-lease`, never `--force`, and only on your own feature branch.
- **Never push directly to `main`.** All changes go through PR + review + merge.

## Shell style (for `scripts/`, `infra/`, CI)

Every script must start with:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
```

Then:

- 2-space indent, no tabs.
- Quote all variable expansions; prefer `${var}` over `$var`.
- `[[ ]]` over `[ ]`; `$(command)` over backticks.
- Errors to STDERR; use `trap cleanup EXIT` where appropriate.
- `lower_case` for functions and variables; `UPPER_CASE` for constants.
- Scripts with functions have `main()` at the bottom; last line is `main "$@"`.

## Binary units in prose

Use binary units (KiB, MiB, GiB, TiB) for memory, storage, and data sizes in prose, reports, and documentation. Exception: provider-native config formats stay as the provider writes them (e.g. Postgres `shared_buffers = '2GB'`).

## Firecracker microVM base image (v0.2 isolation upgrade)

The Sprint 4 microVM substrate (kernel + rootfs build pipeline, spec §2 #2 + §5.13 v0.2) lives under `infra/firecracker/`. Read its README before changing anything in the kernel config or rootfs Dockerfile — the artefact format is the contract issues #115/#116/#117 consume.

## Working with migrations

New migration? Use `bash scripts/next-migration.sh <slug>` — it picks the next free 4-digit prefix and creates both `infra/migrations/` and `infra/sqlever/deploy/` stubs at once. Then add the matching entry to `infra/sqlever/sqitch.plan`. CI runs `bash scripts/check-migrations.sh` (issue #100) to fail fast on prefix collisions.

## Commands you'll use a lot

```sh
# install all deps (uses Bun — see engines.bun in package.json)
bun install

# run the full check locally before pushing
bun run typecheck && bun run lint && bun run build && bun run test

# load all secrets into local env once (saves fingerprint per run)
OP_ACCOUNT=my.1password.com op inject -i .env.op -o .env

# push refreshed infrastructure secrets to /etc/willbuy/secrets.env (Resend, HCLOUD, Cloudflare)
op run --env-file=.env.op -- scripts/push-secrets.sh

# push Stripe config to /etc/willbuy/app.env and restart willbuy-api
op run --env-file=.env.op -- scripts/push-stripe-config.sh

# look up the VM IP without hardcoding
HCLOUD_TOKEN=$(grep ^HCLOUD_TOKEN .env | cut -d= -f2-) hcloud server describe willbuy-v01 -o json | jq -r .public_net.ipv4.ip
```

## Deploys

Pushes to `main` auto-deploy via `.github/workflows/deploy.yml`. No manual SSH needed in normal flow.

```sh
# Manual trigger
gh workflow run deploy.yml --repo NikolayS/willbuy

# Watch a deploy
gh run watch --repo NikolayS/willbuy

# First-time setup per dev machine (Touch-ID-prompted)
bash scripts/setup-auto-deploy.sh
```

The deploy runs `git pull → migrations → next build → service install → docker build → nginx reload → smoke test`. Workflow goes red if `scripts/smoke-test.sh` isn't 11/11.

If an aggregator-side fix needs to be applied to an already-finalized study (`status='ready'`), run on the server:
```sh
bash /srv/willbuy/scripts/reaggregate-study.sh <study_id>
```
This deletes the existing reports row and resets the study to `aggregating`, which the trigger picks up within 30 s.

## When in doubt

Read the spec. Then ask in the issue thread before you write code.
