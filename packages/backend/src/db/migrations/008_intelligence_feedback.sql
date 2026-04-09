-- Migration 008: Intelligence feedback table
--
-- Tracks user feedback on intelligence suggestions (similar bugs, mitigations).
-- Used to compute accuracy stats and feed the RAG learning loop.

SET search_path TO application;

CREATE TABLE IF NOT EXISTS intelligence_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    suggestion_bug_id VARCHAR(255) NOT NULL,
    suggestion_type VARCHAR(50) NOT NULL DEFAULT 'similar_bug',
    rating SMALLINT NOT NULL,
    comment TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT check_rating CHECK (rating IN (-1, 1)),
    CONSTRAINT check_suggestion_type CHECK (suggestion_type IN ('similar_bug', 'mitigation', 'duplicate')),
    CONSTRAINT unique_feedback_per_user UNIQUE (bug_report_id, suggestion_bug_id, user_id)
);

CREATE INDEX idx_feedback_bug_report ON intelligence_feedback(bug_report_id);
CREATE INDEX idx_feedback_project ON intelligence_feedback(project_id);
CREATE INDEX idx_feedback_org ON intelligence_feedback(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_feedback_created ON intelligence_feedback(created_at DESC);

COMMENT ON TABLE intelligence_feedback IS 'User feedback on intelligence suggestions for accuracy tracking';
COMMENT ON COLUMN intelligence_feedback.suggestion_bug_id IS 'ID of the suggested similar/duplicate bug from the intelligence service';
COMMENT ON COLUMN intelligence_feedback.suggestion_type IS 'Type of suggestion: similar_bug, mitigation, or duplicate detection';
COMMENT ON COLUMN intelligence_feedback.rating IS 'Binary rating: 1 (helpful/accurate) or -1 (not helpful/inaccurate)';
