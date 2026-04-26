-- Deploy 0020_report_json
-- Spec ref: §5.18 — pre-computed report blob (issue #170).

BEGIN;

-- 0020_report_json.sql — add report_json for §5.18 pre-computed blob.
--
-- The aggregator writes the full ReportT-shaped JSON blob here once it
-- computes the §5.18 visualization payload. NULL until the aggregator runs.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_json JSONB;

COMMENT ON COLUMN reports.report_json IS
  'Pre-computed §5.18 visualization blob (ReportT shape); NULL until the aggregator writes it (issue #170).';

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0020_report_json.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
