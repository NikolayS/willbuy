# Browser-stack patch SLO — runbook

**Spec refs:** §2 #4 (browser-stack patch/update SLO), §5.16 (full policy),
§6.3 (ship-gate drill).

**Issue:** [#124](https://github.com/NikolayS/willbuy/issues/124)

## SLO statement

| Window                                          | Target |
| ----------------------------------------------- | ------ |
| Weekly canary check (Tuesdays)                  | Every 7 d |
| Upstream Playwright/Chromium release → staging  | ≤ 7 d  |
| Upstream Playwright/Chromium release → prod     | ≤ 14 d |
| Upstream CVE (CVSS ≥ 7.0) → prod                | ≤ 72 h (per §5.16) |
| Canary watch window before promoting to 100 %    | 24 h at 5 % capture traffic |

The SLO covers Chromium, Playwright, container runtime, host kernel,
guest kernel (v0.2 microVM), and Firecracker itself.

## Weekly canary — Tuesday checklist

Owner: Nik. Bring this checklist into the issue thread for the week so
the run is auditable.

1. **Pull the upstream Playwright base image.**
   ```sh
   docker pull mcr.microsoft.com/playwright:v$(node -p "require('./apps/capture-worker/package.json').dependencies.playwright")-jammy
   ```
   If a newer `playwright` minor / patch is available on npm, bump
   `apps/capture-worker/package.json` and `infra/firecracker/rootfs/Dockerfile`
   in the same PR; otherwise this is just a verification pull.

2. **Rebuild the capture-worker image (and the Firecracker rootfs once
   #114 is wired) against the pulled base.**
   The image build is the spec §5.16 "rebuild" step. Image swap requires
   two approvals on the deploy-manifest PR (branch protection on `main`).

3. **Run the canary smoke against staging.**
   ```sh
   WILLBUY_CANARY_BASE_URL=https://staging.willbuy.dev \
     ./scripts/canary/staging-browser-canary.sh
   ```
   Locally, point at the capture-worker's fixture server instead:
   ```sh
   # In one shell — start the existing fixture server (used by tests).
   bun run --filter @willbuy/capture-worker test:integration -- --watch
   # In another — drive the canary at it.
   WILLBUY_CANARY_BASE_URL=http://127.0.0.1:3014 \
     ./scripts/canary/staging-browser-canary.sh
   ```
   Exit code `0` is green, `1` is a regression, `2` is harness error
   (treat as "rerun, then escalate").

4. **If green: tag and push.** Tag the new image as `:canary-YYYY-MM-DD`
   and the previous prod image as `:rollback` (retain 30 days per
   §5.16). Open the deploy-manifest bump PR. Two approvals → merge →
   24 h watch at 5 % traffic → promote to 100 %.

5. **If red: do NOT promote.** Capture the JSON line from the canary's
   stdout into the issue, follow the rollback procedure below, and
   open a `fix(capture-worker):` issue with the canary output pasted
   verbatim. The rollback tag stays as the deployed image until the
   regression is understood.

6. **Document deltas.** Append a one-line entry to the table at the
   bottom of this file: date, Playwright version, Chromium version,
   verdict, image SHA. The first real run on the staging VM is a
   manager action — this PR establishes the process; the first canary
   of record happens AFTER merge.

## Rollback procedure

Triggered by canary red, post-promotion regression, or any CVE-driven
emergency where we need to revert within minutes.

1. **Verify the rollback tag exists.**
   ```sh
   docker manifest inspect ghcr.io/nikolays/willbuy-capture:rollback
   ```
   If missing — escalate, do NOT proceed; we lost the 30-day retention
   invariant and must rebuild from the previous git tag instead.

2. **Single-command rollback** (per §5.16):
   ```sh
   make rollback-capture-image
   ```
   The Makefile target (added when the deploy pipeline lands) updates
   the staging deploy manifest to point at `:rollback`, requires two
   approvals to merge into `main` (branch protection), and triggers
   the rolling restart on `willbuy-v01`.

3. **Confirm.** Re-run the canary against the rolled-back image. It
   must be green before the on-call hands off.

4. **Post-mortem.** File an issue with the canary stdout, the upstream
   diff between the green and red Playwright/Chromium versions, and
   the time-to-detection. Add a regression fixture if the canary
   missed it (the canary is intentionally narrow; widening is a
   normal response to an escape).

## Test fixture target

The canary uses the same deterministic fixture the capture-worker's
golden test uses (`apps/capture-worker/test/fixtures/simple.html`).
Staging exposes it at `/r/test-fixture` via the capture broker's
fixture endpoint; locally the capture-worker test fixture server (port
`3014` by convention) serves it directly. The substring assertions
("Pricing that scales with you", "Postgres logo", "Start free", "Talk
to sales") are pinned by `compareCanaryToBaseline` and exercised by
`apps/capture-worker/test/canary-smoke.test.ts`.

## Out of scope (tracked separately)

- Auto-running the canary on a schedule (cron / GitHub Actions). The
  weekly cadence is a manual-with-checklist action by Nik for v0.2;
  cron lands in a follow-up once we have one quarter of clean manual
  runs.
- The quarterly emergency-CVE drill (§6.3 ship-gate) — next slot is
  Q3, separate issue.
- Cosign key rotation, branch-protection two-approver rule on the
  deploy-manifest PR — covered by the broader §5.16 issue body and
  arrive with the deploy pipeline.

## Run log

| Date       | Playwright | Chromium | Verdict | Image SHA | Notes |
| ---------- | ---------- | -------- | ------- | --------- | ----- |
| _pending_  | _pending_  | _pending_| _pending_ | _pending_ | first canary of record runs post-merge of #124 |
