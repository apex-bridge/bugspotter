# Jira Integration

Complete Jira Cloud integration for BugSpotter. Automatically creates Jira issues from bug reports with screenshots and session replay links.

## Features

- ✅ **Automatic Ticket Creation**: Creates Jira issues from bug reports via job queue
- ✅ **Filtering Rules**: Create rules to control which bug reports trigger ticket creation based on priority, status, browser, OS, URL patterns, and more
- ✅ **Throttling**: Rate-limit ticket creation to prevent spam with configurable max tickets per hour/day, grouped by user, URL, or error type
- ✅ **Secure Credential Storage**: Encrypts API tokens using AES-256-GCM
- ✅ **Per-Project Configuration**: Each project can have its own Jira settings
- ✅ **Screenshot Attachments**: Uploads screenshots directly to Jira issues
- ✅ **Rich Descriptions**: Uses Atlassian Document Format (ADF) for rich text
- ✅ **Connection Testing**: Validates credentials before saving
- ✅ **Extensible Architecture**: Generic integration service registry supports future integrations (GitHub, Linear, Slack)

## Architecture

The Jira integration follows a **decoupled, service-based architecture** to support multiple integration platforms:

```
Integration Worker (Generic)
    ↓
Integration Service Registry
    ↓
Platform-Specific Services (Jira, GitHub, Linear, Slack...)
    ↓
Platform API Clients
```

### Key Components

1. **Base Integration Service** (`src/integrations/base-integration.service.ts`)
   - Interface that all integration services implement
   - Ensures consistent API across platforms

2. **Integration Service Registry** (`src/integrations/integration-registry.ts`)
   - Factory for creating and managing integration services
   - Dynamically routes jobs to the correct platform service

3. **Jira Integration Service** (`src/integrations/jira/service.ts`)
   - Implements `IntegrationService` interface
   - Orchestrates bug report → Jira ticket creation
   - Handles screenshot uploads and external ID storage

4. **Jira Client** (`src/integrations/jira/client.ts`)
   - Pure HTTP client using Node.js `https` module (no dependencies)
   - Handles Jira REST API v3 communication
   - Implements connection testing, issue creation, attachment uploads

5. **Jira Config Manager** (`src/integrations/jira/config.ts`)
   - Loads configuration from environment or database
   - Encrypts/decrypts credentials
   - Validates configuration and tests connection

6. **Bug Report Mapper** (`src/integrations/jira/mapper.ts`)
   - Converts BugReport to Jira issue format
   - Creates rich descriptions with ADF (Atlassian Document Format)
   - Maps priorities (critical → Highest, high → High, etc.)

7. **Encryption Utilities** (`src/utils/encryption.ts`)
   - AES-256-GCM encryption for credentials
   - Scrypt key derivation from master key
   - Authenticated encryption with random IVs and salts

## Setup

### 1. Generate Encryption Key

```bash
# Generate a secure encryption key
openssl rand -base64 32
```

Add to `.env`:

```bash
ENCRYPTION_KEY=your-generated-key-here
```

### 2. Run Database Migration

```bash
pnpm --filter @bugspotter/backend migrate
```

This creates the `project_integrations` table for storing encrypted credentials.

### 3. Configure Jira (Optional Global Config)

Add to `.env` for global/default Jira configuration:

```bash
JIRA_HOST=https://yourcompany.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=BUG
JIRA_ISSUE_TYPE=Bug
```

**Or** configure per-project via API (recommended for multi-tenant).

### 4. Get Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Create API token
3. Copy token (you won't see it again)

## API Endpoints

### Integration Rules

Integration rules allow you to control which bug reports trigger Jira ticket creation. Rules support:

- **Filtering**: Match bug reports based on field conditions
- **Priority-based execution**: Rules with higher priority execute first
- **Throttling**: Rate-limit ticket creation to prevent spam
- **Enable/disable**: Toggle rules on/off without deleting them

#### List Integration Rules

```http
GET /api/v1/integrations/:platform/:projectId/rules
Authorization: Bearer <jwt-token>
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "rule-uuid",
      "project_id": "project-uuid",
      "integration_id": "integration-uuid",
      "name": "High Priority Production Bugs",
      "enabled": true,
      "priority": 100,
      "filters": [
        {
          "field": "priority",
          "operator": "equals",
          "value": "high",
          "case_sensitive": false
        },
        {
          "field": "url_pattern",
          "operator": "contains",
          "value": "production.example.com"
        }
      ],
      "throttle": {
        "max_per_hour": 5,
        "max_per_day": 20,
        "group_by": "user"
      },
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

#### Create Integration Rule

```http
POST /api/v1/integrations/:platform/:projectId/rules
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "name": "Critical Chrome Errors",
  "enabled": true,
  "priority": 200,
  "filters": [
    {
      "field": "priority",
      "operator": "equals",
      "value": "critical"
    },
    {
      "field": "browser",
      "operator": "contains",
      "value": "Chrome"
    }
  ],
  "throttle": {
    "max_per_hour": 10,
    "group_by": "error_type"
  }
}
```

#### Update Integration Rule

```http
PATCH /api/v1/integrations/:platform/:projectId/rules/:ruleId
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "name": "Updated Rule Name",
  "enabled": false,
  "priority": 150,
  "filters": [...],
  "throttle": {...}
}
```

#### Delete Integration Rule

```http
DELETE /api/v1/integrations/:platform/:projectId/rules/:ruleId
Authorization: Bearer <jwt-token>
```

### Filter Fields

Rules can match bug reports based on these fields:

| Field           | Description                       | Example Values                                |
| --------------- | --------------------------------- | --------------------------------------------- |
| `priority`      | Bug report priority               | `critical`, `high`, `medium`, `low`           |
| `status`        | Bug report status                 | `open`, `in_progress`, `resolved`             |
| `browser`       | User's browser                    | `Chrome`, `Firefox`, `Safari`, `Edge`         |
| `os`            | User's operating system           | `Windows`, `macOS`, `Linux`, `iOS`, `Android` |
| `url_pattern`   | Page URL where bug occurred       | `https://example.com/checkout`                |
| `user_email`    | Email of user who reported bug    | `user@example.com`                            |
| `error_message` | Error message text                | `Cannot read property 'x' of undefined`       |
| `project`       | Project identifier (internal use) | `project-uuid`                                |

### Filter Operators

| Operator      | Description                               | Example                                      |
| ------------- | ----------------------------------------- | -------------------------------------------- |
| `equals`      | Exact match (case-insensitive by default) | `priority equals "high"`                     |
| `contains`    | Substring match                           | `url_pattern contains "checkout"`            |
| `regex`       | Regular expression match                  | `error_message regex "TypeError.*undefined"` |
| `in`          | Matches any value in array                | `status in ["open", "in_progress"]`          |
| `not_in`      | Does not match any value in array         | `browser not_in ["IE", "Opera"]`             |
| `starts_with` | String starts with value                  | `url_pattern starts_with "https://app"`      |
| `ends_with`   | String ends with value                    | `user_email ends_with "@company.com"`        |

### Throttle Configuration

Prevent spam by rate-limiting ticket creation:

```json
{
  "max_per_hour": 5, // Maximum tickets per hour
  "max_per_day": 20, // Maximum tickets per day
  "group_by": "user", // Group throttle by: "user", "url", or "error_type"
  "digest_mode": false, // (Optional) Batch tickets into digest
  "digest_interval_minutes": 60 // (Optional) Digest interval
}
```

**Group By Options**:

- `user`: Throttle per user (useful for preventing single user spam)
- `url`: Throttle per URL (useful for page-specific issues)
- `error_type`: Throttle per error signature (useful for recurring errors)

**Example**: With `max_per_hour: 5` and `group_by: "user"`, each user can trigger up to 5 tickets per hour.

### Rule Priority and Execution

Rules are evaluated in **priority order (highest first)**. When multiple rules match:

1. **All matching rules execute** (not just the first match)
2. **Higher priority rules run first** (priority 200 before priority 100)
3. **Each rule creates a ticket** (unless throttled)

**Example**:

```json
[
  {
    "name": "Critical Production Bugs",
    "priority": 200,
    "filters": [{ "field": "priority", "operator": "equals", "value": "critical" }]
  },
  {
    "name": "All Production Bugs",
    "priority": 100,
    "filters": [{ "field": "url_pattern", "operator": "contains", "value": "production" }]
  }
]
```

A critical production bug matches both rules:

1. "Critical Production Bugs" executes first (priority 200)
2. "All Production Bugs" executes second (priority 100)
3. Two Jira tickets are created (one per rule)

**Best Practice**: Use mutually exclusive filters or disable lower-priority rules to avoid duplicate tickets.

### Test Jira Connection

```http
POST /api/integrations/jira/test
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "host": "https://yourcompany.atlassian.net",
  "email": "user@company.com",
  "apiToken": "your-api-token",
  "projectKey": "BUG"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "valid": true,
    "details": {
      "host": "https://yourcompany.atlassian.net",
      "projectExists": true,
      "userHasAccess": true
    }
  }
}
```

### Save Jira Configuration

```http
POST /api/integrations/jira
Content-Type: application/json
Authorization: Bearer <jwt-token>
X-Project-ID: <project-id>

{
  "host": "https://yourcompany.atlassian.net",
  "email": "user@company.com",
  "apiToken": "your-api-token",
  "projectKey": "BUG",
  "issueType": "Bug",
  "enabled": true
}
```

### Get Jira Configuration

```http
GET /api/integrations/jira
Authorization: Bearer <jwt-token>
X-Project-ID: <project-id>
```

Response:

```json
{
  "success": true,
  "data": {
    "host": "https://yourcompany.atlassian.net",
    "projectKey": "BUG",
    "issueType": "Bug",
    "enabled": true
  }
}
```

### Delete Jira Configuration

```http
DELETE /api/integrations/jira
Authorization: Bearer <jwt-token>
X-Project-ID: <project-id>
```

## Usage

### Automatic Integration (Queue-Based)

**When It Happens**: Integration jobs are automatically queued when a bug report is created.

**Prerequisites**:

1. Jira integration configured for the project (via `POST /api/v1/admin/integrations/configure`)
2. Integration enabled (`enabled: true` in project_integrations table)
3. Queue worker running (`INTEGRATION_WORKER_ENABLED=true`)

**Workflow**:

1. **Bug Report Created**: SDK sends bug report to `POST /api/v1/reports`
2. **Integration Check**: Backend queries enabled integrations for project
3. **Job Queueing**: For each enabled integration, a job is queued to BullMQ:
   ```typescript
   {
     bugReportId: 'uuid',
     projectId: 'uuid',
     platform: 'jira',
     credentials: { /* decrypted */ },
     config: { /* from project_integrations */ }
   }
   ```
4. **Worker Processing**: Integration worker picks up job and calls `JiraIntegrationService`
5. **Ticket Creation**: Jira issue created with mapped fields, screenshot uploaded
6. **Metadata Update**: Bug report metadata updated with `external_id` and `external_url`

**Result**: Jira ticket appears within seconds of bug report creation (depending on queue processing speed).

**Error Handling**: If integration fails, job is retried up to 3 times with exponential backoff. Bug report creation succeeds regardless of integration status.

### Manual Integration

```typescript
import { JiraIntegrationService } from './integrations/jira';
import { createDatabaseClient } from './db';
import { createStorage } from './storage';

const db = createDatabaseClient();
const storage = createStorage();
const jiraService = new JiraIntegrationService(db, storage);

// Create ticket from bug report
const result = await jiraService.createTicketFromBugReport(bugReportId);

console.log(`Created Jira issue: ${result.issueKey}`);
console.log(`View at: ${result.issueUrl}`);
```

## Security

### Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: Scrypt with random salt per encryption
- **IV**: Random 128-bit initialization vector per encryption
- **Auth Tag**: 128-bit authentication tag for integrity

### Credential Storage

Credentials are stored in the `project_integrations` table:

- `config` (JSONB): Non-sensitive configuration (host, projectKey, issueType)
- `encrypted_credentials` (TEXT): Encrypted JSON with `{email, apiToken}`

### Defense in Depth

1. **Encryption at rest**: Credentials encrypted in database
2. **Encryption in transit**: HTTPS for Jira API calls
3. **Access control**: Project ownership/membership checked
4. **JWT authentication**: API endpoints require valid JWT
5. **Input validation**: All inputs validated before use

## Adding New Integration Platforms

The architecture supports adding new platforms (GitHub, Linear, Slack) easily:

### 1. Implement `IntegrationService` Interface

```typescript
// src/integrations/github/service.ts
import { IntegrationService, IntegrationResult } from '../base-integration.service';

export class GitHubIntegrationService implements IntegrationService {
  readonly platform = 'github';

  async createFromBugReport(bugReport: BugReport, projectId: string): Promise<IntegrationResult> {
    // 1. Load GitHub config from database
    // 2. Create GitHub issue
    // 3. Return result
  }

  async testConnection(projectId: string): Promise<boolean> {
    // Test GitHub API connection
  }
}
```

### 2. Register in Integration Registry

```typescript
// src/integrations/integration-registry.ts
private registerDefaultServices(): void {
  this.register(new JiraIntegrationService(this.db, this.storage));
  this.register(new GitHubIntegrationService(this.db, this.storage)); // Add here
}
```

### 3. Create API Routes

```typescript
// src/api/routes/integrations.ts
fastify.post('/api/integrations/github', async (request, reply) => {
  // Save GitHub configuration
});
```

That's it! The integration worker will automatically route jobs to the correct service.

## Troubleshooting

### "ENCRYPTION_KEY environment variable is required"

Generate encryption key:

```bash
openssl rand -base64 32
```

Add to `.env`:

```bash
ENCRYPTION_KEY=<generated-key>
```

### "Project not found or you don't have access"

1. Verify project key is correct (uppercase, 2-10 characters)
2. Ensure Jira user has access to project
3. Check API token is valid (not expired)

### "Failed to connect to Jira"

1. Verify Jira host URL (must include `https://`)
2. Check network connectivity
3. Verify API token is valid
4. Check Jira email matches API token owner

### Screenshot Upload Fails

1. Verify storage service is configured correctly
2. Check screenshot URL is accessible
3. Ensure Jira user has permission to add attachments
4. Check file size limits (Jira has 10MB default limit)

## Testing

```bash
# Run all tests
pnpm --filter @bugspotter/backend test

# Run integration tests only
pnpm --filter @bugspotter/backend test:integration
```

## Example Jira Issue

When a bug report is created with:

- Title: "Login button not working"
- Description: "Users can't log in on mobile"
- Priority: "high"
- Screenshot: uploaded

Jira issue will be created with:

- **Summary**: "Login button not working"
- **Description**: Rich ADF format with bug details, metadata, and 🎬 Session Replay link
- **Priority**: High
- **Labels**: ["bugspotter", "automated"]
- **Attachments**: Screenshot uploaded directly

### Console and Network Logs

By default, console and network logs are **not embedded** in Jira descriptions to prevent `CONTENT_LIMIT_EXCEEDED` errors. Instead, users can view logs in the **shared replay viewer**:

1. Click the **🎬 Session Replay** link in the Jira ticket description
2. Navigate to the **Console Logs** or **Network Logs** tab
3. Filter by level/status and export as JSON/CSV if needed

**Default Settings** (recommended):

```typescript
template: {
  includeConsoleLogs: false,  // Logs viewable in shared replay
  includeNetworkLogs: false,  // Logs viewable in shared replay
  includeShareReplay: true,   // Includes 🎬 Session Replay link
}
```

**To embed logs in Jira** (not recommended - may cause field size errors):

```typescript
template: {
  includeConsoleLogs: true,   // Embed in description (risky)
  consoleLogLimit: 10,        // Limit to 10 entries
  includeNetworkLogs: true,   // Embed in description (risky)
  networkLogLimit: 10,        // Limit to 10 entries
}
```

**Warning**: Enabling log embedding may cause `CONTENT_LIMIT_EXCEEDED` errors for tickets with large replay data, especially when HTML/CSS snapshots are included.

**Best Practice**: Keep logs in the shared replay viewer for:

- No Jira field size limits
- Better log filtering and searching
- Export capabilities (JSON/CSV)
- Cleaner Jira ticket descriptions

## License

MIT
