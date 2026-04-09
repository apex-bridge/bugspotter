-- ============================================================================
-- UNIFIED DATABASE SCHEMA FOR BUGSPOTTER
-- ============================================================================
-- Production schema for BugSpotter (as of December 2025)
-- ============================================================================

-- ============================================================================
-- Schema setup
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS application;
CREATE SCHEMA IF NOT EXISTS saas;
-- pgcrypto is NOT needed: gen_random_uuid() is built-in since PostgreSQL 13.
-- Removed CREATE EXTENSION pgcrypto to support managed PostgreSQL services
-- (e.g. Yandex Cloud) where application users lack superuser privileges.

SET search_path TO application;

-- Users table (created first as it's referenced by other tables)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    oauth_provider VARCHAR(50),
    oauth_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    preferences JSONB DEFAULT '{}',
    
    CONSTRAINT unique_oauth_credentials UNIQUE (oauth_provider, oauth_id),
    CONSTRAINT check_auth_method CHECK (
        (password_hash IS NOT NULL AND oauth_provider IS NULL AND oauth_id IS NULL) OR
        (password_hash IS NULL AND oauth_provider IS NOT NULL AND oauth_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_unique 
    ON users(oauth_provider, oauth_id) 
    WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_preferences ON users USING GIN (preferences);

COMMENT ON COLUMN users.preferences IS 'User preferences and settings stored as JSON';

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    settings JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    data_residency_region VARCHAR(20) NOT NULL DEFAULT 'global',
    storage_region VARCHAR(50) NOT NULL DEFAULT 'auto',
    
    CONSTRAINT valid_data_residency_region
    CHECK (data_residency_region IN ('kz', 'rf', 'eu', 'us', 'global'))
);

CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_created_by_id ON projects(created_by, id);
CREATE INDEX IF NOT EXISTS idx_projects_data_residency_region ON projects(data_residency_region);

COMMENT ON TABLE projects IS 'Projects use managed API keys from api_keys table (see api_keys.allowed_projects)';
COMMENT ON COLUMN projects.created_by IS 'User who created the project (owner)';
COMMENT ON COLUMN projects.data_residency_region IS 'Regulatory region for data storage compliance (kz=Kazakhstan, rf=Russia, eu=EU, us=US, global=no restrictions)';
COMMENT ON COLUMN projects.storage_region IS 'Physical storage region identifier (e.g., kz-almaty, rf-moscow, eu-central-1)';

-- ============================================================================
-- PROJECT ROLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  rank INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_project_roles_rank ON project_roles(rank);

INSERT INTO project_roles (name, rank, description) VALUES
  ('owner', 1, 'Project owner with full control and ownership'),
  ('admin', 2, 'Administrative access with project management capabilities'),
  ('member', 3, 'Standard project member with read/write access'),
  ('viewer', 4, 'Read-only access to project data');

-- ============================================================================
-- PROJECT MEMBERS
-- ============================================================================

-- Project members table for multi-user access
CREATE TABLE IF NOT EXISTS project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_project_member UNIQUE (project_id, user_id),
    CONSTRAINT fk_project_members_role FOREIGN KEY (role) REFERENCES project_roles(name) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_project ON project_members(user_id, project_id);

COMMENT ON TABLE project_members IS 'Users who have access to projects (owner, admin, member, viewer)';
COMMENT ON COLUMN project_members.role IS 'User role in project: owner, admin, member, viewer';
COMMENT ON CONSTRAINT fk_project_members_role ON project_members IS 
  'Ensures project member roles are valid and reference the project_roles table';

-- ============================================================================
-- BUG REPORTS
-- ============================================================================

-- Bug reports table
CREATE TABLE IF NOT EXISTS bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    screenshot_url TEXT,
    replay_url TEXT,
    screenshot_key VARCHAR(500),
    thumbnail_key VARCHAR(500),
    replay_key VARCHAR(500),
    upload_status VARCHAR(50) DEFAULT 'none',
    replay_upload_status VARCHAR(50) DEFAULT 'none',
    attachments JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    priority VARCHAR(50) DEFAULT 'medium',
    deleted_at TIMESTAMP WITH TIME ZONE,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    legal_hold BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_upload_status CHECK (upload_status IN ('pending', 'uploading', 'completed', 'failed', 'none')),
    CONSTRAINT check_replay_upload_status CHECK (replay_upload_status IN ('pending', 'uploading', 'completed', 'failed', 'none'))
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_project_created ON bug_reports(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_priority ON bug_reports(priority);
CREATE INDEX IF NOT EXISTS idx_bug_reports_project_status ON bug_reports(project_id, status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_deleted_at ON bug_reports(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bug_reports_legal_hold ON bug_reports(legal_hold) WHERE legal_hold = TRUE;
CREATE INDEX IF NOT EXISTS idx_bug_reports_upload_status ON bug_reports(upload_status) WHERE upload_status != 'completed';
CREATE INDEX IF NOT EXISTS idx_bug_reports_replay_upload_status ON bug_reports(replay_upload_status) WHERE replay_upload_status != 'completed';

-- Performance indexes for active reports
CREATE INDEX IF NOT EXISTS idx_bug_reports_active_project_status_created 
    ON bug_reports(project_id, status, created_at DESC) 
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bug_reports_active_project_priority_created 
    ON bug_reports(project_id, priority, created_at DESC) 
    WHERE deleted_at IS NULL;

COMMENT ON COLUMN bug_reports.deleted_at IS 'Timestamp when report was soft-deleted (NULL = active)';
COMMENT ON COLUMN bug_reports.deleted_by IS 'User who soft-deleted the report';
COMMENT ON COLUMN bug_reports.legal_hold IS 'Prevents automatic deletion by retention policies';
COMMENT ON COLUMN bug_reports.screenshot_key IS 'Storage key for presigned URL lookups (e.g., screenshots/proj-id/bug-id/original.png)';
COMMENT ON COLUMN bug_reports.thumbnail_key IS 'Storage key for thumbnail (e.g., screenshots/proj-id/bug-id/thumbnail.jpg)';
COMMENT ON COLUMN bug_reports.replay_key IS 'Storage key for compressed replay data (e.g., replays/proj-id/bug-id/replay.gz)';
COMMENT ON COLUMN bug_reports.upload_status IS 'Screenshot upload lifecycle: pending (waiting), uploading, completed, failed, none (no screenshot)';
COMMENT ON COLUMN bug_reports.replay_upload_status IS 'Replay upload lifecycle: pending, uploading, completed, failed, none (no replay)';
COMMENT ON COLUMN bug_reports.attachments IS 'Array of attachment metadata: [{key: string, name: string, size: number, contentType: string}]';

-- Archived bug reports table (long-term storage)
CREATE TABLE IF NOT EXISTS archived_bug_reports (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    screenshot_url TEXT,
    replay_url TEXT,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(50) NOT NULL,
    priority VARCHAR(50),
    original_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    original_updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    archived_reason TEXT,
    CONSTRAINT check_archived_date CHECK (archived_at >= deleted_at)
);

CREATE INDEX IF NOT EXISTS idx_archived_bug_reports_project ON archived_bug_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_archived_bug_reports_archived_at ON archived_bug_reports(archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_bug_reports_original_created ON archived_bug_reports(original_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_bug_reports_deleted_by ON archived_bug_reports(deleted_by);

COMMENT ON TABLE archived_bug_reports IS 'Long-term storage for deleted bug reports (compliance/audit)';
COMMENT ON COLUMN archived_bug_reports.archived_reason IS 'Reason for archival (retention_policy, manual, gdpr_request, etc.)';
COMMENT ON COLUMN archived_bug_reports.project_id IS 'Project reference (CASCADE on delete)';
COMMENT ON COLUMN archived_bug_reports.deleted_by IS 'User who deleted the report (SET NULL on user delete)';

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    events JSONB NOT NULL,
    duration INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_bug_report ON sessions(bug_report_id);

-- Permissions table (Enterprise only)
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(50) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_permission UNIQUE (role, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role);

-- ============================================================================
-- SHARE TOKENS
-- ============================================================================

CREATE TABLE IF NOT EXISTS share_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    password_hash TEXT,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT check_token_format CHECK (LENGTH(token) >= 32),
    CONSTRAINT check_expires_future CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_bug_report_id ON share_tokens(bug_report_id);
CREATE INDEX IF NOT EXISTS idx_share_tokens_expires_at ON share_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_share_tokens_created_by ON share_tokens(created_by);
CREATE INDEX IF NOT EXISTS idx_share_tokens_report_active 
    ON share_tokens(bug_report_id, expires_at, deleted_at);

COMMENT ON TABLE share_tokens IS 'Public sharing tokens for session replay access without authentication';
COMMENT ON COLUMN share_tokens.token IS 'Cryptographically random URL-safe token (base64url encoded, 32+ chars)';
COMMENT ON COLUMN share_tokens.expires_at IS 'Token expiration timestamp - access denied after this time';
COMMENT ON COLUMN share_tokens.password_hash IS 'Optional bcrypt hash (10 rounds) for password-protected shares - never use SHA256';
COMMENT ON COLUMN share_tokens.view_count IS 'Number of times replay has been accessed via this token';
COMMENT ON COLUMN share_tokens.created_by IS 'User who generated the share link (NULL if user deleted)';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INTEGRATION MANAGEMENT
-- ============================================================================

-- Integrations table - defines available integration types
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'not_configured',
  config JSONB,
  field_mappings JSONB,
  sync_rules JSONB,
  oauth_tokens JSONB,
  webhook_secret VARCHAR(255),
  last_sync_at TIMESTAMP WITH TIME ZONE,
  is_custom BOOLEAN DEFAULT FALSE,
  plugin_source VARCHAR(50) DEFAULT 'builtin',
  custom_config JSONB,
  trust_level VARCHAR(20) DEFAULT 'custom',
  code_hash VARCHAR(64),
  plugin_code TEXT,
  allow_code_execution BOOLEAN DEFAULT FALSE,
  has_rules BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT check_integration_status CHECK (
    status IN ('not_configured', 'active', 'error', 'disabled')
  ),
  CONSTRAINT check_integration_type_format CHECK (
    type ~ '^[a-z0-9_-]+$'
  ),
  CONSTRAINT check_plugin_source CHECK (
    plugin_source IN ('builtin', 'npm', 'filesystem', 'generic_http')
  ),
  CONSTRAINT check_trust_level CHECK (
    trust_level IN ('builtin', 'custom')
  )
);

CREATE INDEX IF NOT EXISTS idx_integrations_type ON integrations(type);
CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);
CREATE INDEX IF NOT EXISTS idx_integrations_last_sync ON integrations(last_sync_at DESC);

COMMENT ON TABLE integrations IS 'Available integration types (jira, github, linear, etc.)';
COMMENT ON COLUMN integrations.type IS 'Unique platform identifier (e.g., jira, github, custom-crm)';
COMMENT ON COLUMN integrations.has_rules IS 'Whether this integration type supports filtering rules';

-- Seed built-in Jira integration (required by codebase)
INSERT INTO integrations (type, name, description, status, config, has_rules)
VALUES ('jira', 'Jira', 'Atlassian Jira ticket integration', 'not_configured', '{}', TRUE)
ON CONFLICT (type) DO NOTHING;

-- Project integrations table - per-project integration configurations
-- ❗ IMPORTANT: Uses integration_id FK (NOT platform VARCHAR) to match production
CREATE TABLE IF NOT EXISTS project_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    encrypted_credentials TEXT,
    -- Circuit breaker fields
    error_count INTEGER DEFAULT 0 NOT NULL,
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,
    disabled_at TIMESTAMP WITH TIME ZONE,
    disabled_reason TEXT,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_project_integration UNIQUE (project_id, integration_id),
    CONSTRAINT check_error_count CHECK (error_count >= 0),
    CONSTRAINT check_disabled_consistency CHECK (
        (disabled_at IS NULL AND disabled_reason IS NULL) OR 
        (disabled_at IS NOT NULL AND disabled_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_project_integrations_project ON project_integrations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_integrations_integration_id ON project_integrations(integration_id);
CREATE INDEX IF NOT EXISTS idx_project_integrations_enabled ON project_integrations(project_id, enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_project_integrations_disabled 
    ON project_integrations(project_id, disabled_at) 
    WHERE disabled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_integrations_error_count 
    ON project_integrations(error_count, last_error_at) 
    WHERE error_count > 0;

COMMENT ON TABLE project_integrations IS 'Per-project integration configurations with encrypted credentials';
COMMENT ON COLUMN project_integrations.integration_id IS 'Foreign key to integrations table (use this for JOINs, not platform)';
COMMENT ON COLUMN project_integrations.enabled IS 'Whether integration is active for this project';
COMMENT ON COLUMN project_integrations.config IS 'Non-sensitive configuration (project key, repository, channel, etc.)';
COMMENT ON COLUMN project_integrations.encrypted_credentials IS 'Encrypted sensitive credentials (API tokens, passwords)';
COMMENT ON COLUMN project_integrations.error_count IS 'Circuit breaker: consecutive error count';
COMMENT ON COLUMN project_integrations.disabled_at IS 'Circuit breaker: when integration was auto-disabled';

-- ============================================================================
-- INTEGRATION RULES
-- ============================================================================

CREATE TABLE IF NOT EXISTS integration_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES project_integrations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  throttle JSONB DEFAULT NULL,
  auto_create BOOLEAN NOT NULL DEFAULT false,
  field_mappings JSONB DEFAULT NULL,
  description_template TEXT DEFAULT NULL,
  attachment_config JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_rule_name_per_integration UNIQUE(project_id, integration_id, name)
);

CREATE INDEX IF NOT EXISTS idx_integration_rules_enabled_lookup 
  ON integration_rules(project_id, integration_id, enabled)
  WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_integration_rules_priority 
  ON integration_rules(priority DESC);
CREATE INDEX IF NOT EXISTS idx_integration_rules_auto_create
  ON integration_rules(project_id, integration_id)
  WHERE auto_create = true AND enabled = true;

CREATE TRIGGER update_integration_rules_updated_at
  BEFORE UPDATE ON integration_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE integration_rules IS 'Rules for filtering which bug reports trigger integrations (e.g., only high-priority bugs create Jira tickets)';
COMMENT ON COLUMN integration_rules.filters IS 'Array of FilterCondition objects for matching bug reports (same format as notification_rules.filters)';
COMMENT ON COLUMN integration_rules.throttle IS 'Optional ThrottleConfig object for rate limiting integration triggers';
COMMENT ON COLUMN integration_rules.priority IS 'Higher priority rules are evaluated first (for future field mapping support)';
COMMENT ON COLUMN integration_rules.auto_create IS 'Whether to automatically create tickets when bug reports match this rule';
COMMENT ON COLUMN integration_rules.field_mappings IS 'Jira field mappings: { [jiraFieldId: string]: string } - Maps Jira field IDs to BugSpotter field paths';
COMMENT ON COLUMN integration_rules.description_template IS 'Mustache template for ticket description. Available variables: {{title}}, {{description}}, {{priority}}, {{status}}, {{url}}, {{browser}}, {{os}}, {{userId}}';
COMMENT ON COLUMN integration_rules.attachment_config IS 'Attachment configuration: { screenshot?: { enabled: boolean }, console?: { enabled: boolean, levels?: string[], maxEntries?: number }, network?: { enabled: boolean, failedOnly?: boolean, includeBodies?: boolean, maxEntries?: number, redactHeaders?: string[] }, replay?: { enabled: boolean, mode?: "link"|"attach"|"both", expiryHours?: number } }. Default values set by application when auto_create=true.';

-- ============================================================================
-- TICKETS
-- ============================================================================

-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    status VARCHAR(100),
    integration_id UUID DEFAULT NULL REFERENCES project_integrations(id) ON DELETE SET NULL,
    rule_id UUID DEFAULT NULL REFERENCES integration_rules(id) ON DELETE SET NULL,
    created_automatically BOOLEAN NOT NULL DEFAULT false,
    external_url TEXT DEFAULT NULL,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    last_sync_error TEXT DEFAULT NULL,
    attachment_results JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_external_ticket UNIQUE (platform, external_id),
    CONSTRAINT check_sync_status CHECK (sync_status IN ('pending', 'synced', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_bug_report ON tickets(bug_report_id);
CREATE INDEX IF NOT EXISTS idx_tickets_external ON tickets(external_id);
CREATE INDEX IF NOT EXISTS idx_tickets_integration_id ON tickets(integration_id);
CREATE INDEX IF NOT EXISTS idx_tickets_auto_created ON tickets(bug_report_id, created_automatically) WHERE created_automatically = true;
CREATE INDEX IF NOT EXISTS idx_tickets_rule_id ON tickets(rule_id) WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_sync_status ON tickets(sync_status, created_at) WHERE sync_status != 'synced';

COMMENT ON COLUMN tickets.integration_id IS 'Which project_integration created this ticket (NULL for manual creation)';
COMMENT ON COLUMN tickets.rule_id IS 'Which integration_rule triggered automatic creation (NULL for manual creation)';
COMMENT ON COLUMN tickets.created_automatically IS 'Whether ticket was auto-created by a rule (true) or manually created by user (false)';
COMMENT ON COLUMN tickets.external_url IS 'Direct URL to ticket in external platform (e.g., https://company.atlassian.net/browse/BUG-123)';
COMMENT ON COLUMN tickets.sync_status IS 'Synchronization status: pending (initial), synced (successfully created), failed (error occurred)';
COMMENT ON COLUMN tickets.last_sync_error IS 'Last error message if sync_status is failed. Used for debugging and retry logic';
COMMENT ON COLUMN tickets.attachment_results IS 'Array of attachment upload results: [{ type: "screenshot"|"consoleLogs"|"networkLogs"|"replay", success: boolean, filename?: string, error?: string, size?: number }]';

-- ============================================================================
-- TICKET CREATION OUTBOX
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_creation_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_report_id UUID NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES project_integrations(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  rule_id UUID NOT NULL REFERENCES integration_rules(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ,
  external_ticket_id VARCHAR(255),
  external_ticket_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON ticket_creation_outbox(status, scheduled_at) 
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_outbox_bug_report ON ticket_creation_outbox(bug_report_id);
CREATE INDEX IF NOT EXISTS idx_outbox_rule ON ticket_creation_outbox(rule_id);
CREATE INDEX IF NOT EXISTS idx_outbox_integration ON ticket_creation_outbox(integration_id);
CREATE INDEX IF NOT EXISTS idx_outbox_dead_letter ON ticket_creation_outbox(status, updated_at) 
  WHERE status = 'dead_letter';

CREATE TRIGGER trigger_update_outbox_timestamp
  BEFORE UPDATE ON ticket_creation_outbox
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE ticket_creation_outbox IS 'Transactional Outbox Pattern: Ensures ticket creation and database updates are atomic. External API calls happen asynchronously from background worker.';
COMMENT ON COLUMN ticket_creation_outbox.payload IS 'JSONB payload for external ticket creation. Contains title, description, labels, priority, custom fields, etc. Schema varies by platform.';
COMMENT ON COLUMN ticket_creation_outbox.idempotency_key IS 'Unique key (format: {bug_report_id}:{rule_id}:{timestamp}) to prevent duplicate ticket creation on retries.';
COMMENT ON COLUMN ticket_creation_outbox.next_retry_at IS 'Scheduled timestamp for next retry attempt. Uses exponential backoff: 1min, 5min, 30min, 2h, 12h.';
COMMENT ON COLUMN ticket_creation_outbox.status IS 'pending: Awaiting processing | processing: Currently being processed | completed: Successfully created ticket | failed: Retryable failure | dead_letter: Max retries exhausted';

-- System configuration table
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_config_updated_at ON system_config(updated_at DESC);

COMMENT ON TABLE system_config IS 'Global system configuration and retention policies';
COMMENT ON COLUMN system_config.key IS 'Configuration key (e.g., instance_settings, global_retention_policy)';
COMMENT ON COLUMN system_config.value IS 'Configuration value as JSON';
COMMENT ON COLUMN system_config.updated_by IS 'User who last updated this configuration';

-- Insert default instance settings
INSERT INTO system_config (key, value, description) VALUES
    ('instance_settings', '{"instance_name": "BugSpotter", "instance_url": "http://localhost:3000", "support_email": "support@bugspotter.dev", "retention_days": 90, "max_reports_per_project": 10000, "session_replay_enabled": true, "replay_inline_stylesheets": true, "replay_inline_images": false, "replay_collect_fonts": true, "replay_record_canvas": false, "replay_record_cross_origin_iframes": false}'::jsonb, 'Instance-wide configuration settings (admin panel)'),
    ('notification_retention', '{"history_retention_days": 30, "throttle_cleanup_days": 1}'::jsonb, 'Notification system data retention policies')
ON CONFLICT (key) DO NOTHING;

-- Triggers to automatically update updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bug_reports_updated_at
    BEFORE UPDATE ON bug_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_integrations_updated_at
    BEFORE UPDATE ON project_integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at
    BEFORE UPDATE ON system_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default permissions
INSERT INTO permissions (role, resource, action) VALUES
    ('admin', 'bug_report', 'create'),
    ('admin', 'bug_report', 'read'),
    ('admin', 'bug_report', 'update'),
    ('admin', 'bug_report', 'delete'),
    ('admin', 'project', 'create'),
    ('admin', 'project', 'read'),
    ('admin', 'project', 'update'),
    ('admin', 'project', 'delete'),
    ('admin', 'user', 'create'),
    ('admin', 'user', 'read'),
    ('admin', 'user', 'update'),
    ('admin', 'user', 'delete'),
    ('admin', 'settings', 'read'),
    ('admin', 'settings', 'update'),
    ('user', 'bug_report', 'create'),
    ('user', 'bug_report', 'read'),
    ('user', 'bug_report', 'update'),
    ('user', 'project', 'read'),
    ('viewer', 'bug_report', 'read'),
    ('viewer', 'project', 'read'),
    -- Integration Rules Permissions
    ('admin', 'integration_rules', 'create'),
    ('admin', 'integration_rules', 'read'),
    ('admin', 'integration_rules', 'update'),
    ('admin', 'integration_rules', 'delete'),
    ('user', 'integration_rules', 'create'),
    ('user', 'integration_rules', 'read'),
    ('user', 'integration_rules', 'update'),
    ('viewer', 'integration_rules', 'read'),
    -- Data Residency Permissions
    ('admin', 'data_residency', 'read'),
    ('admin', 'data_residency', 'update'),
    ('admin', 'data_residency', 'audit'),
    ('user', 'data_residency', 'read'),
    ('user', 'data_residency', 'update'),
    ('viewer', 'data_residency', 'read')
ON CONFLICT (role, resource, action) DO NOTHING;

-- Audit logs table for tracking all administrative actions
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    resource VARCHAR(255) NOT NULL,
    resource_id TEXT,
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    success BOOLEAN DEFAULT true,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource_pattern ON audit_logs(resource text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_audit_success ON audit_logs(success);
CREATE INDEX IF NOT EXISTS idx_audit_resource_id ON audit_logs(resource_id) WHERE resource_id IS NOT NULL;

COMMENT ON TABLE audit_logs IS 'Audit trail of all administrative actions';
COMMENT ON COLUMN audit_logs.action IS 'HTTP method or custom action type';
COMMENT ON COLUMN audit_logs.resource IS 'API path or resource type';
COMMENT ON COLUMN audit_logs.resource_id IS 'Identifier for the audited resource (can be UUID, file path, S3 key, etc.)';
COMMENT ON COLUMN audit_logs.details IS 'JSON payload with request body and metadata';

-- ============================================================================
-- DATA RESIDENCY AUDIT TABLES
-- ============================================================================

-- Data residency audit table for compliance tracking
CREATE TABLE IF NOT EXISTS data_residency_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id TEXT,
    storage_region VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Data residency violations table for tracking policy violations
CREATE TABLE IF NOT EXISTS data_residency_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    violation_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    attempted_action VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    source_region VARCHAR(50),
    target_region VARCHAR(50),
    blocked BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_violation_type
    CHECK (violation_type IN (
        'storage_region_mismatch',
        'cross_region_transfer',
        'unauthorized_processing',
        'policy_change_denied'
    ))
);

-- Indexes for data residency audit tables
CREATE INDEX IF NOT EXISTS idx_data_residency_audit_project_id
    ON data_residency_audit(project_id);

CREATE INDEX IF NOT EXISTS idx_data_residency_audit_created_at
    ON data_residency_audit(created_at);

CREATE INDEX IF NOT EXISTS idx_data_residency_violations_project_id
    ON data_residency_violations(project_id);

CREATE INDEX IF NOT EXISTS idx_data_residency_violations_created_at
    ON data_residency_violations(created_at);

-- Comments for data residency tables
COMMENT ON TABLE data_residency_audit IS 'Audit log for data access operations under data residency compliance';
COMMENT ON COLUMN data_residency_audit.resource_id IS 'Identifier for the audited resource (can be UUID, file path, S3 key, etc.)';
COMMENT ON TABLE data_residency_violations IS 'Records of data residency policy violations (blocked and logged)';

-- ============================================================================
-- NOTIFICATION SYSTEM
-- ============================================================================

-- Notification Channels
CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('email', 'slack', 'webhook', 'discord', 'teams')),
    config JSONB NOT NULL, -- encrypted sensitive fields
    active BOOLEAN DEFAULT true,
    last_success_at TIMESTAMP WITH TIME ZONE,
    last_failure_at TIMESTAMP WITH TIME ZONE,
    failure_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_config_not_empty CHECK (jsonb_typeof(config) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_channels_project ON notification_channels(project_id);
CREATE INDEX IF NOT EXISTS idx_channels_project_type ON notification_channels(project_id, type);
CREATE INDEX IF NOT EXISTS idx_channels_type ON notification_channels(type);
CREATE INDEX IF NOT EXISTS idx_channels_active ON notification_channels(active);
CREATE INDEX IF NOT EXISTS idx_channels_last_success ON notification_channels(last_success_at DESC);

COMMENT ON TABLE notification_channels IS 'Configured notification delivery channels';
COMMENT ON COLUMN notification_channels.config IS 'Channel-specific configuration (SMTP, webhooks, etc.)';
COMMENT ON COLUMN notification_channels.failure_count IS 'Consecutive failure count for health monitoring';

-- Notification Rules
CREATE TABLE IF NOT EXISTS notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    triggers JSONB NOT NULL, -- array of trigger conditions
    filters JSONB, -- optional filter conditions
    throttle JSONB, -- throttle configuration
    schedule JSONB, -- schedule configuration
    priority INT DEFAULT 0, -- rule evaluation order (higher first)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_triggers_not_empty CHECK (jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0)
);

CREATE INDEX IF NOT EXISTS idx_rules_project ON notification_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_rules_project_enabled ON notification_rules(project_id, enabled);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON notification_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON notification_rules(priority DESC);

COMMENT ON TABLE notification_rules IS 'Rules defining when and how to send notifications';
COMMENT ON COLUMN notification_rules.triggers IS 'Array of trigger conditions (new_bug, priority_change, etc.)';
COMMENT ON COLUMN notification_rules.priority IS 'Higher priority rules are evaluated first';

-- Rule-Channel Mapping (many-to-many)
CREATE TABLE IF NOT EXISTS notification_rule_channels (
    rule_id UUID NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (rule_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_channels_rule ON notification_rule_channels(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_channels_channel ON notification_rule_channels(channel_id);

COMMENT ON TABLE notification_rule_channels IS 'Associates rules with their delivery channels';

-- Notification Templates
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    channel_type VARCHAR(50) NOT NULL CHECK (channel_type IN ('email', 'slack', 'webhook', 'discord', 'teams')),
    trigger_type VARCHAR(50) NOT NULL CHECK (trigger_type IN ('new_bug', 'bug_resolved', 'priority_change', 'threshold_reached', 'error_spike', 'digest')),
    subject VARCHAR(500), -- for email
    body TEXT NOT NULL,
    variables JSONB, -- array of available variables
    version INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Partial unique index to ensure only one active template per channel+trigger combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_template 
    ON notification_templates(channel_type, trigger_type) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_templates_channel_trigger ON notification_templates(channel_type, trigger_type);
CREATE INDEX IF NOT EXISTS idx_templates_active ON notification_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_version ON notification_templates(channel_type, trigger_type, version DESC);

COMMENT ON TABLE notification_templates IS 'Message templates for different notification types';
COMMENT ON COLUMN notification_templates.version IS 'Template version for history tracking';
COMMENT ON INDEX idx_unique_active_template IS 'Only one active template per channel+trigger combination';

-- Notification History
CREATE TABLE IF NOT EXISTS notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID REFERENCES notification_channels(id) ON DELETE SET NULL,
    rule_id UUID REFERENCES notification_rules(id) ON DELETE SET NULL,
    template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
    bug_id UUID REFERENCES bug_reports(id) ON DELETE SET NULL,
    recipients JSONB,
    payload JSONB,
    response JSONB,
    status VARCHAR(50) NOT NULL CHECK (status IN ('sent', 'failed', 'pending', 'throttled')),
    error TEXT,
    attempts INT DEFAULT 1,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_delivered_if_sent CHECK (
        (status = 'sent' AND delivered_at IS NOT NULL) OR 
        (status != 'sent')
    )
);

CREATE INDEX IF NOT EXISTS idx_history_created ON notification_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_status ON notification_history(status);
CREATE INDEX IF NOT EXISTS idx_history_channel ON notification_history(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_rule ON notification_history(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_bug ON notification_history(bug_id);
CREATE INDEX IF NOT EXISTS idx_history_delivered ON notification_history(delivered_at DESC) WHERE delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_history_recipients_gin ON notification_history USING gin(recipients);

COMMENT ON TABLE notification_history IS 'Log of all notification delivery attempts';
COMMENT ON COLUMN notification_history.recipients IS 'Recipient email(s) as JSON array - supports efficient queries for multiple recipients';
COMMENT ON COLUMN notification_history.attempts IS 'Number of delivery attempts made';
COMMENT ON COLUMN notification_history.payload IS 'Rendered notification payload sent to channel';
COMMENT ON COLUMN notification_history.response IS 'Response from channel (HTTP response, SMTP result, etc.)';

-- Notification Throttle Tracking
CREATE TABLE IF NOT EXISTS notification_throttle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
    group_key VARCHAR(500) NOT NULL, -- e.g., "error_sig:12345", "project:abc"
    count INT DEFAULT 0,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_window_valid CHECK (window_end > window_start),
    CONSTRAINT unique_throttle_window UNIQUE (rule_id, group_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_throttle_lookup ON notification_throttle(rule_id, group_key, window_end);
CREATE INDEX IF NOT EXISTS idx_throttle_cleanup ON notification_throttle(window_end);

COMMENT ON TABLE notification_throttle IS 'Tracks notification counts for throttle limits';
COMMENT ON COLUMN notification_throttle.group_key IS 'Grouping key for throttle (error signature, project ID, etc.)';
COMMENT ON COLUMN notification_throttle.window_start IS 'Start of throttle time window';
COMMENT ON COLUMN notification_throttle.window_end IS 'End of throttle time window';

-- Insert default email template for new bugs
INSERT INTO notification_templates (name, channel_type, trigger_type, subject, body, variables) VALUES
(
    'Default New Bug Email',
    'email',
    'new_bug',
    '[{{project.name}}] New Bug: {{bug.title}}',
    E'<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #dc3545; margin-top: 0;">🐛 New Bug Report</h2>
        
        <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
            <h3 style="margin-top: 0;">{{bug.title}}</h3>
            <p><strong>Message:</strong> {{bug.message}}</p>
            <p><strong>Priority:</strong> <span style="color: {{bug.priorityColor}}">{{bug.priority}}</span></p>
            <p><strong>Project:</strong> {{project.name}}</p>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
            <h4 style="margin-top: 0;">Environment</h4>
            <ul>
                <li><strong>Browser:</strong> {{bug.browser}}</li>
                <li><strong>OS:</strong> {{bug.os}}</li>
                <li><strong>User:</strong> {{bug.user.email}}</li>
                <li><strong>URL:</strong> {{bug.url}}</li>
            </ul>
        </div>
        
        <div style="margin-top: 20px;">
            <a href="{{link.bugDetail}}" style="display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">View Bug Details</a>
            {{#if link.replay}}
            <a href="{{link.replay}}" style="display: inline-block; padding: 12px 24px; background: #6c757d; color: white; text-decoration: none; border-radius: 4px; margin-left: 10px;">Watch Replay</a>
            {{/if}}
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px;">
            <p>Reported at {{timestamp}} ({{timezone}})</p>
            <p>This is an automated notification from BugSpotter</p>
        </div>
    </div>
</body>
</html>',
    '[
        {"name": "bug.id", "description": "Bug report ID", "example": "123e4567-e89b-12d3-a456-426614174000"},
        {"name": "bug.title", "description": "Bug title", "example": "TypeError: Cannot read property"},
        {"name": "bug.message", "description": "Error message", "example": "Uncaught TypeError: Cannot read property..."},
        {"name": "bug.priority", "description": "Bug priority", "example": "critical"},
        {"name": "bug.priorityColor", "description": "Color for priority badge", "example": "#dc3545"},
        {"name": "bug.browser", "description": "Browser name and version", "example": "Chrome 120.0"},
        {"name": "bug.os", "description": "Operating system", "example": "Windows 11"},
        {"name": "bug.user.email", "description": "User email", "example": "user@example.com"},
        {"name": "bug.url", "description": "Page URL where bug occurred", "example": "https://app.example.com/dashboard"},
        {"name": "project.name", "description": "Project name", "example": "My App"},
        {"name": "project.id", "description": "Project ID", "example": "proj-123"},
        {"name": "link.bugDetail", "description": "Link to bug detail page", "example": "https://admin.bugspotter.io/bugs/123"},
        {"name": "link.replay", "description": "Link to session replay", "example": "https://admin.bugspotter.io/replay/456"},
        {"name": "timestamp", "description": "Formatted timestamp", "example": "2025-10-20 14:30:00"},
        {"name": "timezone", "description": "Timezone name", "example": "UTC"}
    ]'::jsonb
),
(
    'Default New Bug Slack',
    'slack',
    'new_bug',
    NULL,
    E'{
  "text": "🐛 *New Bug Report*",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🐛 New Bug in {{project.name}}"
      }
    },
    {
      "type": "section",
      "fields": [
        {"type": "mrkdwn", "text": "*Title:*\\n{{bug.title}}"},
        {"type": "mrkdwn", "text": "*Priority:*\\n{{bug.priority}}"},
        {"type": "mrkdwn", "text": "*Browser:*\\n{{bug.browser}}"},
        {"type": "mrkdwn", "text": "*OS:*\\n{{bug.os}}"}
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Message:*\\n```{{bug.message}}```"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {"type": "plain_text", "text": "View Details"},
          "url": "{{link.bugDetail}}",
          "style": "primary"
        }
      ]
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "Reported by {{bug.user.email}} at {{timestamp}}"
        }
      ]
    }
  ]
}',
    '[
        {"name": "bug.title", "description": "Bug title", "example": "TypeError: Cannot read property"},
        {"name": "bug.message", "description": "Error message", "example": "Uncaught TypeError"},
        {"name": "bug.priority", "description": "Bug priority", "example": "critical"},
        {"name": "bug.browser", "description": "Browser name", "example": "Chrome 120.0"},
        {"name": "bug.os", "description": "Operating system", "example": "Windows 11"},
        {"name": "bug.user.email", "description": "User email", "example": "user@example.com"},
        {"name": "project.name", "description": "Project name", "example": "My App"},
        {"name": "link.bugDetail", "description": "Link to bug detail page", "example": "https://admin.bugspotter.io/bugs/123"},
        {"name": "timestamp", "description": "Formatted timestamp", "example": "2025-10-20 14:30:00"}
    ]'::jsonb
);

-- Triggers for updated_at (use generic update_updated_at_column function)
CREATE TRIGGER update_channels_updated_at
    BEFORE UPDATE ON notification_channels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rules_updated_at
    BEFORE UPDATE ON notification_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_templates_updated_at
    BEFORE UPDATE ON notification_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_throttle_updated_at
    BEFORE UPDATE ON notification_throttle
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up old notification history (configurable retention)
CREATE OR REPLACE FUNCTION cleanup_old_notification_history()
RETURNS void AS $$
DECLARE
    retention_days INTEGER;
BEGIN
    -- Get retention period from system_config, default to 30 days if not set
    SELECT COALESCE((value->>'history_retention_days')::INTEGER, 30)
    INTO retention_days
    FROM system_config
    WHERE key = 'notification_retention';
    
    DELETE FROM notification_history
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    RAISE NOTICE 'Deleted notification history older than % days', retention_days;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired throttle windows (configurable retention)
CREATE OR REPLACE FUNCTION cleanup_expired_throttle_windows()
RETURNS void AS $$
DECLARE
    cleanup_days INTEGER;
BEGIN
    -- Get cleanup period from system_config, default to 1 day if not set
    SELECT COALESCE((value->>'throttle_cleanup_days')::INTEGER, 1)
    INTO cleanup_days
    FROM system_config
    WHERE key = 'notification_retention';
    
    DELETE FROM notification_throttle
    WHERE window_end < CURRENT_TIMESTAMP - (cleanup_days || ' days')::INTERVAL;
    
    RAISE NOTICE 'Deleted throttle windows older than % days', cleanup_days;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_notification_history() IS 'Removes notification history based on configurable retention period (system_config.notification_retention.history_retention_days)';
COMMENT ON FUNCTION cleanup_expired_throttle_windows() IS 'Removes throttle tracking data based on configurable cleanup period (system_config.notification_retention.throttle_cleanup_days)';

-- Integration sync activity log
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_type VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  bug_id UUID REFERENCES bug_reports(id) ON DELETE SET NULL,
  external_id VARCHAR(255),
  external_url TEXT,
  status VARCHAR(50) NOT NULL,
  error TEXT,
  request JSONB,
  response JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT check_sync_action CHECK (
    action IN ('create', 'update', 'sync', 'error', 'test')
  ),
  CONSTRAINT check_sync_status CHECK (
    status IN ('pending', 'success', 'failed', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS idx_sync_log_integration ON integration_sync_log(integration_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_bug ON integration_sync_log(bug_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON integration_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_external_id ON integration_sync_log(external_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_created_at ON integration_sync_log(created_at DESC);

COMMENT ON TABLE integration_sync_log IS 'Activity log for integration sync operations';
COMMENT ON COLUMN integration_sync_log.duration_ms IS 'Duration of sync operation in milliseconds';
COMMENT ON COLUMN integration_sync_log.external_id IS 'ID in external system (e.g., JIRA-123, GH#456)';

-- Field mappings table (alternative to JSONB column for complex mappings)
CREATE TABLE IF NOT EXISTS integration_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_type VARCHAR(50) NOT NULL,
  source_field VARCHAR(255) NOT NULL,
  target_field VARCHAR(255) NOT NULL,
  transform_type VARCHAR(50),
  transform_config JSONB,
  required BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT check_transform_type CHECK (
    transform_type IS NULL OR
    transform_type IN ('direct', 'template', 'function', 'lookup')
  ),
  UNIQUE(integration_type, source_field, target_field)
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_integration ON integration_field_mappings(integration_type);

COMMENT ON TABLE integration_field_mappings IS 'Maps BugSpotter fields to external system fields with transformations';
COMMENT ON COLUMN integration_field_mappings.transform_type IS 'How to transform the value (direct copy, template, custom function, lookup table)';
COMMENT ON COLUMN integration_field_mappings.transform_config IS 'Configuration for transformation (template string, function code, lookup table)';

-- Webhook endpoints for incoming webhooks
CREATE TABLE IF NOT EXISTS integration_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_type VARCHAR(50) NOT NULL,
  endpoint_url VARCHAR(500) NOT NULL UNIQUE,
  secret VARCHAR(255) NOT NULL,
  events TEXT[],
  active BOOLEAN DEFAULT true,
  last_received_at TIMESTAMP WITH TIME ZONE,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT check_failure_count CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_integration ON integration_webhooks(integration_type);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON integration_webhooks(active);
CREATE INDEX IF NOT EXISTS idx_webhooks_endpoint ON integration_webhooks(endpoint_url);

COMMENT ON TABLE integration_webhooks IS 'Incoming webhook configurations for integrations';
COMMENT ON COLUMN integration_webhooks.events IS 'Events this webhook is subscribed to';
COMMENT ON COLUMN integration_webhooks.failure_count IS 'Number of consecutive failures (for circuit breaker)';

-- OAuth tokens table (separate table for better security)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_type VARCHAR(50) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  scope VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_integration ON oauth_tokens(integration_type);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);

COMMENT ON TABLE oauth_tokens IS 'OAuth access and refresh tokens for integrations (should be encrypted at rest)';
COMMENT ON COLUMN oauth_tokens.access_token IS 'OAuth access token (encrypted)';
COMMENT ON COLUMN oauth_tokens.refresh_token IS 'OAuth refresh token (encrypted)';
COMMENT ON COLUMN oauth_tokens.scope IS 'OAuth scopes granted';

-- Update triggers for integrations tables
CREATE TRIGGER update_integrations_updated_at
    BEFORE UPDATE ON integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_oauth_tokens_updated_at
    BEFORE UPDATE ON oauth_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- No pre-seeded integrations - all integrations are created dynamically via admin UI
-- This allows users to add any integration type (builtin plugins, npm packages, or generic HTTP)

-- ============================================================================
-- API KEY MANAGEMENT SYSTEM
-- ============================================================================

-- API Keys table - Enhanced for enterprise-grade management
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Key identification (only hash stored, never plaintext)
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL,
  key_suffix VARCHAR(8) NOT NULL,
  
  -- Metadata
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL DEFAULT 'production',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  
  -- Permissions
  permission_scope VARCHAR(50) NOT NULL DEFAULT 'full',
  permissions JSONB DEFAULT '[]'::jsonb,
  allowed_projects UUID[],
  allowed_environments TEXT[],
  
  -- Rate Limiting
  rate_limit_per_minute INTEGER DEFAULT 500,
  rate_limit_per_hour INTEGER DEFAULT 10000,
  rate_limit_per_day INTEGER DEFAULT 100000,
  burst_limit INTEGER DEFAULT 1000,
  per_endpoint_limits JSONB,
  
  -- Security
  ip_whitelist INET[],
  allowed_origins TEXT[],
  user_agent_pattern TEXT,
  
  -- Lifecycle
  expires_at TIMESTAMP WITH TIME ZONE,
  rotate_at TIMESTAMP WITH TIME ZONE,
  grace_period_days INTEGER DEFAULT 7,
  rotated_from UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  
  -- Audit
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id UUID,
  tags TEXT[],
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT check_api_key_type CHECK (type IN ('production', 'development', 'test')),
  CONSTRAINT check_api_key_status CHECK (status IN ('active', 'expiring', 'expired', 'revoked')),
  CONSTRAINT check_permission_scope CHECK (permission_scope IN ('full', 'read', 'write', 'custom')),
  CONSTRAINT check_rate_limits CHECK (
    rate_limit_per_minute >= 0 AND
    rate_limit_per_hour >= 0 AND
    rate_limit_per_day >= 0 AND
    burst_limit >= 0
  ),
  CONSTRAINT check_grace_period CHECK (grace_period_days >= 0)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status) WHERE status IN ('active', 'expiring');
CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(type);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_rotate ON api_keys(rotate_at) WHERE rotate_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_team ON api_keys(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at DESC NULLS LAST);

COMMENT ON TABLE api_keys IS 'Enhanced API key management with permissions, rate limiting, and rotation';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the actual API key (never store plaintext)';
COMMENT ON COLUMN api_keys.key_prefix IS 'Visible prefix for identification (e.g., bs_prod)';
COMMENT ON COLUMN api_keys.key_suffix IS 'Last 4-8 characters for user identification';
COMMENT ON COLUMN api_keys.permission_scope IS 'Permission level: full, read, write, or custom';
COMMENT ON COLUMN api_keys.permissions IS 'Array of specific permissions (e.g., ["bugs:read", "bugs:write"])';
COMMENT ON COLUMN api_keys.allowed_projects IS 'Project UUIDs this key can access (NULL = all projects)';
COMMENT ON COLUMN api_keys.allowed_environments IS 'Environment restrictions (e.g., ["production", "staging"])';
COMMENT ON COLUMN api_keys.per_endpoint_limits IS 'Custom rate limits per endpoint';
COMMENT ON COLUMN api_keys.ip_whitelist IS 'CIDR blocks allowed to use this key';
COMMENT ON COLUMN api_keys.rotated_from IS 'Previous key in rotation chain';
COMMENT ON COLUMN api_keys.grace_period_days IS 'Days both old and new keys work during rotation';

-- ============================================================================
-- API KEY CLEANUP TRIGGERS
-- ============================================================================

-- Function to remove deleted projects from API keys and revoke orphaned keys
CREATE OR REPLACE FUNCTION cleanup_api_keys_on_project_delete()
RETURNS TRIGGER AS $$
DECLARE
  affected_keys UUID[];
  revoked_count INTEGER;
BEGIN
  -- Remove the deleted project UUID from all api_keys.allowed_projects arrays
  -- Store the IDs of affected keys for efficient orphan check
  WITH updated_keys AS (
    UPDATE api_keys
    SET
      allowed_projects = array_remove(allowed_projects, OLD.id),
      updated_at = CURRENT_TIMESTAMP
    WHERE
      allowed_projects @> ARRAY[OLD.id]::UUID[]
    RETURNING id
  )
  SELECT ARRAY_AGG(id) INTO affected_keys FROM updated_keys;

  -- Early return if no keys were affected
  IF affected_keys IS NULL THEN
    RETURN OLD;
  END IF;

  -- Revoke only the API keys that were just modified and now have empty allowed_projects
  -- This is much more efficient than scanning the entire table
  -- Note: cardinality() returns the number of elements in the array (0 for empty arrays)
  UPDATE api_keys
  SET
    status = 'revoked',
    revoked_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE
    id = ANY(affected_keys)
    AND allowed_projects IS NOT NULL
    AND cardinality(allowed_projects) = 0
    AND status = 'active';

  -- Get count of revoked keys
  GET DIAGNOSTICS revoked_count = ROW_COUNT;

  -- Log the cleanup operation with accurate counts
  RAISE NOTICE 'Removed project % from % API key(s), revoked % orphaned key(s)',
    OLD.id, array_length(affected_keys, 1), COALESCE(revoked_count, 0);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that runs BEFORE project deletion
CREATE TRIGGER trigger_cleanup_api_keys_on_project_delete
  BEFORE DELETE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_api_keys_on_project_delete();

COMMENT ON FUNCTION cleanup_api_keys_on_project_delete IS
  'Removes deleted project UUIDs from api_keys.allowed_projects arrays and revokes keys that become orphaned (empty allowed_projects)';
COMMENT ON TRIGGER trigger_cleanup_api_keys_on_project_delete ON projects IS
  'Automatically cleans up API key project references when a project is deleted';

-- API Key usage tracking
CREATE TABLE IF NOT EXISTS api_key_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  
  -- Request details
  endpoint VARCHAR(500) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  
  -- Client details
  ip_address INET,
  user_agent TEXT,
  
  -- Error tracking
  error_message TEXT,
  error_type VARCHAR(100),
  
  -- Timestamp
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_key_time ON api_key_usage(api_key_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_endpoint ON api_key_usage(endpoint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_status ON api_key_usage(status_code) WHERE status_code >= 400;
CREATE INDEX IF NOT EXISTS idx_usage_errors ON api_key_usage(error_type) WHERE error_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON api_key_usage(timestamp);

COMMENT ON TABLE api_key_usage IS 'Tracks all API requests for analytics and monitoring';
COMMENT ON COLUMN api_key_usage.response_time_ms IS 'Response time in milliseconds for performance tracking';

-- Rate limit tracking (sliding window)
CREATE TABLE IF NOT EXISTS api_key_rate_limits (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_type VARCHAR(20) NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  request_count INTEGER DEFAULT 0 NOT NULL,
  
  PRIMARY KEY (api_key_id, window_type, window_start),
  
  CONSTRAINT check_window_type CHECK (window_type IN ('minute', 'hour', 'day', 'burst')),
  CONSTRAINT check_request_count CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON api_key_rate_limits(window_start);

COMMENT ON TABLE api_key_rate_limits IS 'Tracks request counts for rate limiting (sliding window algorithm)';
COMMENT ON COLUMN api_key_rate_limits.window_type IS 'Time window: minute, hour, day, or burst (10 seconds)';

-- API Key audit log
CREATE TABLE IF NOT EXISTS api_key_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address INET,
  changes JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT check_audit_action CHECK (
    action IN (
      'created', 'updated', 'rotated', 'revoked', 
      'permissions_changed', 'rate_limit_changed',
      'accessed', 'failed_auth', 'rate_limited'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_key_audit_key ON api_key_audit_log(api_key_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_key_audit_user ON api_key_audit_log(performed_by, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_key_audit_action ON api_key_audit_log(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_key_audit_timestamp ON api_key_audit_log(timestamp DESC);

COMMENT ON TABLE api_key_audit_log IS 'Audit trail for all API key management actions';
COMMENT ON COLUMN api_key_audit_log.changes IS 'JSON diff of changes made (for update actions)';

-- Trigger to update api_keys.updated_at
CREATE TRIGGER update_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to check if API key is expired
CREATE OR REPLACE FUNCTION is_api_key_expired(key_expires_at TIMESTAMP WITH TIME ZONE)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN key_expires_at IS NOT NULL AND key_expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION is_api_key_expired IS 'Check if API key has passed expiration date (STABLE: result depends on CURRENT_TIMESTAMP)';

-- Function to clean up old rate limit tracking data
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  -- Delete rate limit windows older than 2 days (well past any window)
  DELETE FROM api_key_rate_limits
  WHERE window_start < CURRENT_TIMESTAMP - INTERVAL '2 days';
  
  RAISE NOTICE 'Deleted rate limit windows older than 2 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_rate_limits IS 'Cleanup expired rate limit tracking windows (run daily via cron)';

-- Function to clean up old usage data (configurable retention)
CREATE OR REPLACE FUNCTION cleanup_old_api_key_usage(retention_days INTEGER DEFAULT 90)
RETURNS void AS $$
BEGIN
  -- Delete usage logs older than retention period
  DELETE FROM api_key_usage
  WHERE timestamp < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
  
  RAISE NOTICE 'Deleted API key usage logs older than % days', retention_days;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_api_key_usage IS 'Cleanup old API key usage data (configurable retention in days)';

-- ============================================================================
-- SCHEMA CONFIGURATION
-- ============================================================================

-- NOTE: search_path is set at the connection/session level by:
-- 1. Migration runner (migrate.ts): SET search_path before running migrations
-- 2. Database client (client.ts): SET search_path on every new pool connection
--    (via pool 'connect' event — NOT the -c options startup parameter, which
--    breaks through PgBouncer connection poolers)
--
-- This approach works across all environments (dev, test, production) without
-- hardcoding database names. Each connection establishes the correct schema
-- search order: application -> saas -> public

-- ============================================================================
-- SAAS MULTI-TENANT TABLES
-- ============================================================================
-- These tables support multi-tenant SaaS mode. They live in the 'saas' schema
-- to keep clear separation from core application tables.
--
-- In self-hosted mode these tables exist but remain empty.
-- In SaaS mode, organization_id on projects/bug_reports links tenants to their data.
-- ============================================================================

SET search_path TO saas;

-- Organizations table - core tenant entity
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(63) UNIQUE NOT NULL,
    data_residency_region VARCHAR(20) NOT NULL DEFAULT 'global',
    storage_region VARCHAR(50) NOT NULL DEFAULT 'auto',
    subscription_status VARCHAR(20) NOT NULL DEFAULT 'trial',
    trial_ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_organization_data_residency_region CHECK (
        data_residency_region IN ('kz', 'rf', 'eu', 'us', 'global')
    )
);

CREATE INDEX IF NOT EXISTS idx_organizations_subdomain ON organizations(subdomain);
CREATE INDEX IF NOT EXISTS idx_organizations_subscription_status ON organizations(subscription_status);
CREATE INDEX IF NOT EXISTS idx_organizations_data_residency_region ON organizations(data_residency_region);
CREATE INDEX IF NOT EXISTS idx_organizations_trial_ends_at ON organizations(trial_ends_at) WHERE trial_ends_at IS NOT NULL;

COMMENT ON TABLE organizations IS 'SaaS tenant organizations';
COMMENT ON COLUMN organizations.subdomain IS 'Unique subdomain for tenant access (e.g., acme.bugspotter.io)';
COMMENT ON COLUMN organizations.subscription_status IS 'Current billing status: trial, active, past_due, canceled, trial_expired';

CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- Organization members - links users to organizations with roles
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES application.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_organization_member UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_organization_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

-- Enforce one owner per organization at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_one_owner_per_org 
    ON organization_members(organization_id) 
    WHERE role = 'owner';

COMMENT ON TABLE organization_members IS 'Maps users to organizations with role-based access';
COMMENT ON COLUMN organization_members.role IS 'Role within organization: owner (1 per org), admin, member';

CREATE TRIGGER update_org_members_updated_at
    BEFORE UPDATE ON organization_members
    FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- Subscriptions - provider-agnostic billing integration (Kaspi Pay, YooKassa, Stripe)
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    plan_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    payment_provider VARCHAR(20),
    external_subscription_id VARCHAR(255),
    external_customer_id VARCHAR(255),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    quotas JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_subscription_plan CHECK (
        plan_name IN ('trial', 'starter', 'professional', 'enterprise')
    ),
    CONSTRAINT valid_subscription_billing_status CHECK (
        status IN ('trial', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'paused')
    )
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_external_sub_id ON subscriptions(payment_provider, external_subscription_id) WHERE external_subscription_id IS NOT NULL;

COMMENT ON TABLE subscriptions IS 'Billing subscriptions with provider-agnostic payment integration';
COMMENT ON COLUMN subscriptions.quotas IS 'Plan limits as JSON: {max_projects, max_bug_reports, max_storage_bytes, ...}';
COMMENT ON COLUMN subscriptions.payment_provider IS 'Payment provider: kaspi, yookassa, or stripe';
COMMENT ON COLUMN subscriptions.external_subscription_id IS 'External subscription ID from the payment provider';

CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- Usage records - metering for billing and quota enforcement
CREATE TABLE IF NOT EXISTS usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    quantity BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_usage_record UNIQUE (organization_id, period_start, resource_type),
    CONSTRAINT valid_resource_type CHECK (
        resource_type IN ('projects', 'bug_reports', 'storage_bytes', 'api_calls', 'screenshots', 'session_replays')
    )
);

CREATE INDEX IF NOT EXISTS idx_usage_records_organization_id ON usage_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_org_period ON usage_records(organization_id, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_records_resource_type ON usage_records(resource_type);
CREATE INDEX IF NOT EXISTS idx_usage_records_period_start ON usage_records(period_start);

COMMENT ON TABLE usage_records IS 'Tracks resource usage per organization per billing period';
COMMENT ON COLUMN usage_records.resource_type IS 'Type of resource being metered';
COMMENT ON COLUMN usage_records.quantity IS 'Current count or bytes used in this period';

CREATE TRIGGER update_usage_records_updated_at
    BEFORE UPDATE ON usage_records
    FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- ============================================================================
-- LINK APPLICATION TABLES TO SAAS ORGANIZATIONS
-- ============================================================================
-- Add nullable organization_id to core tables.
-- NULL = self-hosted mode (no org association)
-- Populated = SaaS mode (tenant isolation)

ALTER TABLE application.projects
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES saas.organizations(id) ON DELETE CASCADE;

ALTER TABLE application.bug_reports
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES saas.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON application.projects(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bug_reports_organization_id ON application.bug_reports(organization_id) WHERE organization_id IS NOT NULL;

-- Reset search_path
SET search_path TO application, saas, public;

