-- 0020_report_json.sql — add report_json for §5.18 pre-computed blob.
--
-- The aggregator writes the full ReportT-shaped JSON blob here once it
-- computes the §5.18 visualization payload. NULL until the aggregator runs.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_json JSONB;
