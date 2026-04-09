SET search_path TO application;

-- Add duplicate_of column to track which bug this report duplicates.
-- NULL = not a duplicate; non-null = points to the canonical bug report.
ALTER TABLE bug_reports
  ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES bug_reports(id) ON DELETE SET NULL;

-- A bug cannot be a duplicate of itself.
ALTER TABLE bug_reports
  ADD CONSTRAINT chk_bug_reports_no_self_duplicate CHECK (duplicate_of IS NULL OR duplicate_of <> id);

-- Partial index: only index rows that are actually duplicates.
CREATE INDEX IF NOT EXISTS idx_bug_reports_duplicate_of
  ON bug_reports(duplicate_of) WHERE duplicate_of IS NOT NULL;
