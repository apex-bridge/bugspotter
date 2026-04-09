-- Migration 013: Bug mitigations table
-- Stores AI-generated mitigation suggestions (async pipeline)

SET search_path TO application;

CREATE TABLE IF NOT EXISTS bug_mitigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES saas.organizations(id) ON DELETE SET NULL,
    mitigation_suggestion TEXT NOT NULL,
    based_on_similar_bugs BOOLEAN NOT NULL DEFAULT false,
    mitigation_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One mitigation per bug (upsert target)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mitigation_bug_report
    ON bug_mitigations(bug_report_id);

-- Query by project
CREATE INDEX IF NOT EXISTS idx_mitigation_project
    ON bug_mitigations(project_id);

-- Multi-tenant isolation
CREATE INDEX IF NOT EXISTS idx_mitigation_org
    ON bug_mitigations(organization_id) WHERE organization_id IS NOT NULL;
