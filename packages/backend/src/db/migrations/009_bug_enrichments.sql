-- Migration 009: Bug enrichments table
--
-- Stores AI-generated enrichment data for bug reports:
-- categorization, suggested severity, tags, root cause summary, affected components.
-- Each field has a confidence score (0.0 - 1.0).

SET search_path TO application;

CREATE TABLE IF NOT EXISTS bug_enrichments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID,
    category VARCHAR(100) NOT NULL,
    suggested_severity VARCHAR(20) NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    root_cause_summary TEXT NOT NULL,
    affected_components TEXT[] NOT NULL DEFAULT '{}',
    confidence_category REAL NOT NULL DEFAULT 0,
    confidence_severity REAL NOT NULL DEFAULT 0,
    confidence_tags REAL NOT NULL DEFAULT 0,
    confidence_root_cause REAL NOT NULL DEFAULT 0,
    confidence_components REAL NOT NULL DEFAULT 0,
    enrichment_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT check_confidence_category CHECK (confidence_category >= 0 AND confidence_category <= 1),
    CONSTRAINT check_confidence_severity CHECK (confidence_severity >= 0 AND confidence_severity <= 1),
    CONSTRAINT check_confidence_tags CHECK (confidence_tags >= 0 AND confidence_tags <= 1),
    CONSTRAINT check_confidence_root_cause CHECK (confidence_root_cause >= 0 AND confidence_root_cause <= 1),
    CONSTRAINT check_confidence_components CHECK (confidence_components >= 0 AND confidence_components <= 1)
);

-- One enrichment per bug (upsert increments enrichment_version)
CREATE UNIQUE INDEX idx_enrichment_bug_report ON bug_enrichments(bug_report_id);
CREATE INDEX idx_enrichment_project ON bug_enrichments(project_id);
CREATE INDEX idx_enrichment_category ON bug_enrichments(project_id, category);
CREATE INDEX idx_enrichment_org ON bug_enrichments(organization_id) WHERE organization_id IS NOT NULL;

COMMENT ON TABLE bug_enrichments IS 'AI-generated enrichment data for bug reports with confidence scores';
COMMENT ON COLUMN bug_enrichments.enrichment_version IS 'Incremented on each re-enrichment to track freshness';
COMMENT ON COLUMN bug_enrichments.tags IS 'Auto-generated tags array from intelligence analysis';
COMMENT ON COLUMN bug_enrichments.affected_components IS 'System components affected by this bug';
