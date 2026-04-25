# Report perf budget — spec §5.18

The report page MUST hit **FCP ≤ 1.5 s** on a 5 Mbps uplink at N=30
paired (the canonical "happy path" fixture). The check runs Lighthouse
in the desktop preset with throughput throttled to 5 Mbps, against a
prod build of `apps/web` serving the report fixture.

## Runner

```sh
# from the repo root
cd apps/web
WILLBUY_REPORT_FIXTURE=enabled pnpm next build
WILLBUY_REPORT_FIXTURE=enabled pnpm next start &
node test/perf/lighthouse.mjs   # prints { url, fcp_ms, budget_ms, pass }
kill %1
```

If `lighthouse` and `chrome-launcher` are not resolvable the runner
exits with code 2 and a remediation hint; the deps are intentionally
NOT pinned in `package.json` to keep the workspace install slim. CI
provisions them on the runner image and exports `CHROMIUM_PATH`.

## Fixture URL

`http://localhost:3000/r/test-fixture` — fed by
`apps/web/app/r/[slug]/fetchReport.ts` from
`apps/web/test/fixtures/report.fixture.json` when
`WILLBUY_REPORT_FIXTURE=enabled`.

## Budget knobs

- FCP budget: 1500 ms (spec §5.18)
- Network: 5 Mbps throughput, 40 ms RTT
- Form factor: desktop, viewport 1366×900
- CPU slowdown multiplier: 1 (no CPU throttling — §5.18 calls out
  client-side rendering only)

## Failure mode

The runner exits non-zero and prints a JSON line; the failure shows up
in CI as a perf-regression alert. Tracking issue: see §6.2 "Perf
regression" — that test asserts the *aggregator* end-to-end budget;
this runner asserts the *report page* render budget. Both must pass
for ship.
