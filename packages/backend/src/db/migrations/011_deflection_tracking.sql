-- Migration 011: Self-service deflection tracking
--
-- Tracks when end users self-resolve by finding a matching known resolution
-- before submitting a new bug report. Used for ROI measurement.

SET search_path TO application;

CREATE TABLE IF NOT EXISTS intelligence_deflections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    matched_bug_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    description_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_deflections_dedup
    ON intelligence_deflections(project_id, matched_bug_id, description_hash);

CREATE INDEX idx_deflections_org ON intelligence_deflections(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_deflections_project ON intelligence_deflections(project_id);
CREATE INDEX idx_deflections_created ON intelligence_deflections(created_at DESC);

COMMENT ON TABLE intelligence_deflections IS 'Tracks self-service deflection events when users find existing resolutions';
COMMENT ON COLUMN intelligence_deflections.matched_bug_id IS 'The resolved bug report that matched the user description';
COMMENT ON COLUMN intelligence_deflections.description_hash IS 'SHA-256 hash of the submitted description for deduplication';
