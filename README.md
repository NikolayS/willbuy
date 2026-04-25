# willbuy.dev

Marketing-page conversion-friction lab. See [`SPEC.md`](./.samo/spec/willbuy/SPEC.md) for the full specification and [`CLAUDE.md`](./CLAUDE.md) for engineering principles every contributor (human or agent) must follow.

## Requirements

- Node `>= 22` (see `.nvmrc`)
- `pnpm` (see `packageManager` in `package.json`)

## Install

```sh
pnpm install
```

## Common scripts

```sh
pnpm dev        # run all workspaces in parallel (no apps yet)
pnpm build      # build all workspaces
pnpm typecheck  # tsc -b across the repo
pnpm lint       # eslint flat config across the repo
pnpm test       # vitest run
pnpm format     # prettier --write
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
