# willbuy.dev

Marketing-page conversion-friction lab. See [`SPEC.md`](./.samo/spec/willbuy/SPEC.md) for the full specification and [`CLAUDE.md`](./CLAUDE.md) for engineering principles every contributor (human or agent) must follow.

## Requirements

- [Bun](https://bun.sh) `>= 1.1` — single binary that replaces Node + pnpm + tsx

## Install

```sh
bun install
```

## Common scripts

```sh
bun run dev        # run all workspaces in parallel
bun run build      # build all workspaces
bun run typecheck  # tsc -b across the repo
bun run lint       # eslint flat config across the repo
bun run test       # vitest run (vitest kept as test framework; bun as package manager)
bun run format     # prettier --write
```

## Layout

```
apps/       # Next.js web, Fastify api, capture worker, visitor worker (added per-issue)
packages/   # shared libs: llm-adapter, schemas, etc. (added per-issue)
tests/      # repo-level tests (lint-rule fixtures live here)
infra/      # provisioning scripts and infra-as-code
scripts/    # operator scripts (e.g. push-secrets.sh)
```

## Public-repo discipline

This repo is **public**. No secrets, no IPs, no anything that leaks operational specifics. See `CLAUDE.md` §"Public repo discipline".

## TDD

`CLAUDE.md` §"TDD: red → green → refactor" is mandatory. PRs without a red commit before the green commit get sent back.

## 💰 Bounty Contribution

- **Task:** finding(pricing): 40% of visitors pick free hobby tier — pricing page under-conv
- **Reward:** $49
- **Source:** GitHub-Paid
- **Date:** 2026-04-27

