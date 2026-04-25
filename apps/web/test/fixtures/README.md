# Report fixtures — wire shape contract

These JSON fixtures define the **report payload contract** between:

- the aggregator (issue #31, Python in the pinned scientific-stack
  container — spec §17), which writes the JSON blob onto
  `reports.scores_json` / `reports.paired_delta_json` / `reports.clusters_json`
  per spec §5.11, and
- the web report page (issue #35, this PR), which consumes one blob and
  renders the seven §5.18 visual elements.

## Authoritative schema

`packages/shared/src/report.ts` — `Report` zod schema. The test
`apps/web/test/report-viz.test.ts` parses every fixture in this directory
through that schema; if the aggregator produces something the schema
rejects, CI fails before render.

## Field map (schema → §5.18 element)

| schema field   | §5.18 element |
| -------------- | ------------- |
| `headline`     | 1 — header / headline delta (mean δ, 95% CI, paired-t / Wilcoxon / McNemar p, verdict, disagreement flag per §2 #19) |
| `paired_dots`  | 2 — paired-delta dot plot (the key viz) |
| `histograms`   | 3 — will-to-buy histograms per variant |
| `next_actions` | 4 — next-action stacked bar / Sankey toggle (8 actions per amendment A1) |
| `tier_picked`  | 5 — tier-picked distribution per variant |
| `theme_board`  | 6 — top blockers / objections / confusions / questions |
| `personas`     | 7 — persona cards grid |
| `meta`         | study slug + `low_power` flag (spec §9 statistical-overclaim row, N<20 → low-power banner) |

## Files

- `report.fixture.json` — happy-path study, N=30 paired, B converts
  better, tests-agree (no disagreement banner). Drives most rendering tests.
- `report.disagreement.fixture.json` — paired-t p=0.041, Wilcoxon p=0.092
  (one < 0.05, the other ≥ 0.05) → §2 #19 disagreement rule fires. Drives
  the disagreement-banner test.

## Public-repo audit

Both fixtures use obviously-fabricated persona names (`Persona One` …
`Persona Alpha`). No real names, no email addresses, no URLs, no IPs.
The data is hand-crafted and does NOT come from a real study. This
matches spec §5.10 (untrusted-content render boundary) and the public-repo
discipline in `CLAUDE.md`.

## For the aggregator engineer (#31)

When you wire the aggregator output, parse against `Report` from
`@willbuy/shared/report` at the API-boundary (per the zod-at-the-boundary
rule in `CLAUDE.md`). If you need to add a field, update `report.ts`
**and** at least one fixture in this directory in the same PR — that
keeps the report page's tests honest about the shape it consumes.
