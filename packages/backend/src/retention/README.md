# Data Retention Policy System

Comprehensive data retention and lifecycle management for BugSpotter with multi-region compliance support.

## Overview

The retention system provides:

- **Automated cleanup**: Daily scheduled jobs to delete old data
- **Soft delete**: Safe deletion with restore capability
- **Legal hold**: Prevent deletion of specific reports
- **Archival**: Long-term storage before permanent deletion
- **Multi-region compliance**: Support for GDPR (EU), SOX/HIPAA (US), Kazakhstan law, UK-GDPR, PIPEDA (Canada)
- **Tier-based limits**: Free (max 60 days), Professional (up to 1 year), Enterprise (unlimited)
- **Extensible**: Easy to add new compliance regions and data classifications

**Test Status**: ✅ 869/869 tests passing (entire backend test suite)

## Architecture

```
retention/
├── types.ts              # TypeScript type definitions
├── retention-config.ts   # Configuration and defaults
├── retention-service.ts  # Core service with orchestration
├── retention-scheduler.ts # Cron-based scheduler
├── schemas.ts            # Zod validation schemas
└── index.ts              # Public API exports

db/
├── repositories.ts       # BugReportRepository with retention methods
└── constants.ts          # Database operation constants (batch sizes, limits)
```

### Components

**BugReportRepository** (retention methods consolidated from deprecated RetentionRepository):

- `findEligibleForDeletion()` - Find reports older than retention cutoff
- `softDelete()` - Mark reports as deleted (with legal hold protection)
- `restore()` - Restore soft-deleted reports
- `hardDelete()` - Permanently delete reports
- `hardDeleteInTransaction()` - Delete within transaction context with report details
- `setLegalHold()` - Set legal hold flag (data layer only)
- `countLegalHoldReports()` - Count protected reports

**RetentionService**: Main orchestrator for retention operations

- `applyRetentionPolicies()` - Apply policies across all projects
- `previewRetentionPolicy()` - Dry-run preview with actual storage sizes (queries S3/local storage)
- `softDeleteReports()` - Soft delete with restore capability
- `hardDeleteReports()` - Permanent deletion with certificate generation
- `archiveReports()` - Archive to `archived_bug_reports` table (batch insert)
- `restoreReports()` - Restore soft-deleted reports (**NOTE**: archived reports cannot be restored)
- `setLegalHold()` - Apply/remove legal hold with audit logging and project tracking (calls repository method)

**RetentionScheduler**: Automated job execution

- Runs daily at 2 AM (configurable via cron expression)
- Batch processing with error handling
- Email notifications (placeholder for implementation)

## Configuration

### Environment Variables

```bash
# Retention periods (days)
DEFAULT_RETENTION_DAYS=90
SCREENSHOT_RETENTION_DAYS=60
REPLAY_RETENTION_DAYS=30
ATTACHMENT_RETENTION_DAYS=90
ARCHIVED_RETENTION_DAYS=365

# Compliance region: none, eu, us, kz, uk, ca
# Determines regulatory requirements
COMPLIANCE_REGION=none

# Scheduler
RETENTION_CRON_SCHEDULE="0 2 * * *"  # Daily at 2 AM
RETENTION_CRON_TIMEZONE="UTC"        # Timezone for scheduled jobs
RETENTION_SCHEDULER_ENABLED=true
```

### Project-Level Settings

Stored in `projects.settings` JSONB column:

```typescript
{
  tier: 'enterprise',
  retention: {
    bugReportRetentionDays: 365,
    screenshotRetentionDays: 180,
    replayRetentionDays: 90,
    attachmentRetentionDays: 365,
    archivedRetentionDays: 1825,  // 5 years for financial data
    archiveBeforeDelete: true,
    dataClassification: 'financial',  // general, financial, government, healthcare, pii, sensitive
    complianceRegion: 'kz'           // none, eu, us, kz, uk, ca
  },
  minimumRetentionDays: 1825  // Calculated from classification + region
}
```

## Tier-Based Limits

| Tier         | Min Retention | Max Retention | Archive Required |
| ------------ | ------------- | ------------- | ---------------- |
| Free         | 7 days        | 60 days       | No               |
| Professional | 30 days       | 365 days      | Yes              |
| Enterprise   | 30 days       | Unlimited     | Yes              |

## Multi-Region Compliance

### Supported Compliance Regions

The system supports multiple regulatory frameworks:

| Region             | Code   | Frameworks              | Deletion Certificate | True Deletion Required |
| ------------------ | ------ | ----------------------- | -------------------- | ---------------------- |
| **None**           | `none` | No specific regulations | No                   | No                     |
| **European Union** | `eu`   | GDPR                    | Yes                  | Yes                    |
| **United States**  | `us`   | SOX, HIPAA, IRS         | Yes                  | No                     |
| **Kazakhstan**     | `kz`   | Local accounting law    | Yes                  | Yes                    |
| **United Kingdom** | `uk`   | UK-GDPR                 | Yes                  | Yes                    |
| **Canada**         | `ca`   | PIPEDA, provincial laws | No                   | No                     |

### Data Classification Minimums

Minimum retention periods by region and classification:

```typescript
// European Union - GDPR
eu: {
  financial: 365,  // 1 year
  pii: 0,          // Delete when no longer needed
}

// United States - Federal laws
us: {
  financial: 2555,  // 7 years (SOX, IRS)
  healthcare: 2555, // 7 years (HIPAA)
  government: 1095, // 3 years
}

// Kazakhstan - Local regulations
kz: {
  general: 90,      // 3 months
  financial: 1825,  // 5 years
  government: 1825, // 5 years
  healthcare: 3650, // 10 years
}

// United Kingdom - UK-GDPR + local
uk: {
  financial: 2190,  // 6 years (tax)
  healthcare: 2920, // 8 years (NHS)
}

// Canada - PIPEDA
ca: {
  financial: 2190,  // 6 years (CRA)
  healthcare: 3650, // 10 years (provincial)
}
```

### Adding New Compliance Regions

Easily extend with new regions:

```typescript
// In retention-config.ts
export const COMPLIANCE_MIN_RETENTION: Record<
  string,
  Partial<Record<DataClassification, number>>
> = {
  // ... existing regions ...

  // Add new region
  au: {
    // Australia
    general: 0,
    financial: 2555, // 7 years (ATO)
    healthcare: 2555, // 7 years (AHPRA)
  },
};

// Configure region-specific requirements
TRUE_DELETION_REQUIRED.add('au');
DELETION_CERTIFICATE_REQUIRED.add('au');
```

### Deletion Certificates

Generated automatically when required by regional regulations:

```typescript
{
  certificateId: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "...",
  reportIds: ["...", "..."],
  deletedAt: "2025-10-11T10:00:00Z",
  deletedBy: "user-id",
  reason: "retention_policy",
  dataClassification: "financial",
  complianceRegion: "kz",  // or "eu", "us", etc.
  verificationHash: "sha256...",
  issuedAt: "2025-10-11T10:00:00Z"
}
```

**Certificate is automatically generated when:**

- `requiresDeletionCertificate(complianceRegion)` returns true
- Regions: EU, US, Kazakhstan

**API Endpoints**

**Status**: ✅ Fully implemented with authentication and validation

### Admin Endpoints

**GET /api/v1/admin/retention**

- Get current retention policy configuration
- Requires: Admin role

**PUT /api/v1/admin/retention**

- Update global retention policy (**NOT IMPLEMENTED** - returns HTTP 501)
- Global policies are currently configured via environment variables
- Use project-specific retention policies instead
- Requires: Admin role

**POST /api/v1/admin/retention/preview**

- Preview what would be deleted (dry-run)
- Query params: `projectId` (optional)
- Requires: Admin role

**POST /api/v1/admin/retention/apply**

- Manually trigger retention policy
- Body: `{ dryRun?, batchSize?, maxErrorRate?, confirm? }`
- Requires: Admin role, confirmation for > 100 reports

**POST /api/v1/admin/retention/legal-hold**

- Apply or remove legal hold
- Body: `{ reportIds: string[], hold: boolean }`
- Requires: Admin role

**POST /api/v1/admin/retention/restore**

- Restore soft-deleted reports
- Body: `{ reportIds: string[] }`
- Requires: Admin role

**DELETE /api/v1/admin/retention/hard-delete**

- Permanently delete reports (generates certificate)
- Body: `{ reportIds: string[], confirm: true, generateCertificate? }`
- Requires: Admin role, explicit confirmation

**GET /api/v1/admin/retention/status**

- Get scheduler status
- Requires: Admin role

### Project Endpoints

**GET /api/v1/projects/:id/retention**

- Get project-specific retention settings
- Requires: Project member

**PUT /api/v1/projects/:id/retention**

- Update project retention settings
- Requires: Project owner or admin

## Database Schema

### Bug Reports (Updated)

```sql
ALTER TABLE bug_reports ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bug_reports ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE bug_reports ADD COLUMN legal_hold BOOLEAN DEFAULT FALSE NOT NULL;

CREATE INDEX idx_bug_reports_deleted_at ON bug_reports(deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_bug_reports_legal_hold ON bug_reports(legal_hold)
  WHERE legal_hold = TRUE;
```

### Archived Bug Reports

```sql
CREATE TABLE archived_bug_reports (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    -- All original bug_reports columns --
    original_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    original_updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_by UUID,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    archived_reason TEXT
);
```

## Usage Examples

### Basic Setup

```typescript
import { createDatabaseClient } from './db/client.js';
import { createStorage } from './storage/index.js';
import { RetentionService, RetentionScheduler } from './retention/index.js';

// Initialize services
const db = await createDatabaseClient();
const storage = await createStorage();
const retentionService = new RetentionService(db, storage);
const retentionScheduler = new RetentionScheduler(retentionService);

// Start scheduler
retentionScheduler.start();
```

### Manual Retention Application

```typescript
// Preview what would be deleted
const preview = await retentionService.previewRetentionPolicy();
console.log(`Would delete ${preview.totalReports} reports`);

// Apply with dry-run
const dryRunResult = await retentionService.applyRetentionPolicies({
  dryRun: true,
  batchSize: 100,
});

// Apply for real
const result = await retentionService.applyRetentionPolicies({
  dryRun: false,
  batchSize: 100,
  maxErrorRate: 5,
});
```

### Legal Hold Management

```typescript
// Apply legal hold
await retentionService.setLegalHold(
  ['report-id-1', 'report-id-2'],
  true, // hold = true
  'admin-user-id'
);

// Remove legal hold
await retentionService.setLegalHold(
  ['report-id-1', 'report-id-2'],
  false, // hold = false
  'admin-user-id'
);
```

### Restore Deleted Reports

```typescript
// Restore soft-deleted reports (still in bug_reports table)
const restoredCount = await retentionService.restoreReports(['report-id-1', 'report-id-2']);

console.log(`Restored ${restoredCount} reports`);

// NOTE: Archived reports (moved to archived_bug_reports table) cannot be restored
// They are considered permanently deleted for compliance purposes
```

## Testing

**Current Status**: ✅ 869/869 tests passing (100%)

- **retention-config.test.ts**: 47 tests - Configuration, validation, compliance rules
- **retention-scheduler.test.ts**: 13 tests - Scheduler lifecycle, error handling
- **retention-service.test.ts**: 25 tests - Service orchestration, legal hold, restore operations
- **repositories.test.ts**: 24 tests - BugReportRepository methods including retention operations
- **Plus**: 750+ additional backend tests (API routes, database, storage, etc.)

```bash
# Run all tests (includes retention)
pnpm --filter @bugspotter/backend test

# Run specific test files
pnpm --filter @bugspotter/backend test retention-config
pnpm --filter @bugspotter/backend test retention-scheduler
pnpm --filter @bugspotter/backend test retention-service
pnpm --filter @bugspotter/backend test repositories  # Includes retention methods
```

## Implementation Safeguards

1. **Dry-run mode**: Preview deletions without making changes
2. **Confirmation required**: Manual deletions > 100 reports need explicit confirmation
3. **Error rate monitoring**: Stop if error rate exceeds 5%
4. **Batch processing**: Process in batches to avoid memory issues
5. **Legal hold protection**: Reports on legal hold cannot be deleted
6. **Soft delete first**: Default to soft delete with restore capability
7. **Audit logging**: All operations logged to `audit_logs` table

## Monitoring

Track retention metrics:

- Storage freed per run
- Reports deleted/archived
- Error rates and failures
- Legal hold count
- Processing duration

## Future Enhancements

- [ ] Email notifications on completion/errors
- [ ] Slack/webhook integrations
- [ ] S3 lifecycle rules integration
- [ ] Backup before bulk delete
- [ ] GDPR immediate deletion workflow
- [ ] Retention policy templates
- [ ] Export before delete functionality

## Implementation Status

✅ **Complete**:

- Core retention service with all operations (soft delete, hard delete, archive, restore, legal hold)
- Multi-region compliance framework (6 regions)
- Automated scheduler with cron support
- Configuration system with tier limits and named constants
- Comprehensive test suite (869 tests, 100% passing)
- API endpoints fully implemented with authentication
- Repository consolidation (eliminated 90-100% code duplication)
- Magic numbers extracted to constants
- Database migrations integrated
- Actual storage size calculation in preview (queries S3/local storage)

⏳ **Future Work**:

- Global retention policy persistence (requires system_config table)
- Email/webhook notifications
- Monitoring and metrics dashboard
- S3 archival strategy (currently uses deletion strategy)
