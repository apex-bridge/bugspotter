# Plugin Utils API Documentation

**Version**: 1.0.0  
**Module**: `@bugspotter/backend/integrations/plugin-utils`

## Overview

Plugin Utils provides a comprehensive set of reusable helpers for building custom ticket integrations with platforms like Jira, GitHub, Linear, Azure DevOps, Asana, and more. These utilities eliminate code duplication and provide standardized patterns for common operations.

## Architecture

Plugin utils are exposed to custom plugins through:

1. **Global constants**: `ERROR_CODES`, `validators` (synchronous access)
2. **RPC methods**: All utility functions available via `utils.*` namespace
3. **Type-safe**: Full TypeScript support with proper error handling

## Table of Contents

- [Authentication](#authentication)
- [HTTP Utilities](#http-utilities)
- [Storage](#storage)
- [Metadata Extraction](#metadata-extraction)
- [Validation](#validation)
- [Error Handling](#error-handling)
- [Retry Logic](#retry-logic)

---

## Authentication

### `utils.buildAuthHeader(authConfig)`

Build authentication headers for various auth types.

**Parameters**:

- `authConfig` (Object): Authentication configuration
  - `type` (String): Auth type - `'basic'`, `'bearer'`, `'oauth2'`, `'pat'`, `'api-key'`, `'custom'`
  - `username` (String): For basic auth
  - `password` (String): For basic auth
  - `token` (String): For bearer/oauth2/PAT/API key
  - `headerValue` (String): For custom auth

**Returns**: `Promise<string>` - Authorization header value

**Examples**:

```javascript
// Basic authentication (Jira, Azure DevOps)
const header = await utils.buildAuthHeader({
  type: 'basic',
  username: 'user@example.com',
  password: 'api-token-123',
});
// Returns: "Basic dXNlckBleGFtcGxlLmNvbTphcGktdG9rZW4tMTIz"

// Bearer token (GitHub, GitLab, Linear)
const header = await utils.buildAuthHeader({
  type: 'bearer',
  token: 'ghp_abc123xyz',
});
// Returns: "Bearer ghp_abc123xyz"

// OAuth2
const header = await utils.buildAuthHeader({
  type: 'oauth2',
  token: 'ya29.a0AfH6...',
});
// Returns: "Bearer ya29.a0AfH6..."

// API Key (raw)
const header = await utils.buildAuthHeader({
  type: 'api-key',
  token: 'sk-1234567890abcdef',
});
// Returns: "sk-1234567890abcdef"

// Custom header value
const header = await utils.buildAuthHeader({
  type: 'custom',
  headerValue: 'Token ' + apiToken,
});
// Returns: "Token abc123"
```

---

## HTTP Utilities

### `utils.makeApiRequest(config)`

Make HTTP requests with consistent error handling, SSRF protection, and automatic response parsing.

**Parameters**:

- `config` (Object): Request configuration
  - `baseUrl` (String): Base API URL (e.g., `https://api.example.com`)
  - `endpoint` (String): Endpoint path (e.g., `/issues`)
  - `method` (String): HTTP method - `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (default: `GET`)
  - `authHeader` (String): Authorization header value (from `buildAuthHeader`)
  - `body` (Object|String): Request body (auto-stringified if object)
  - `contentType` (String): Content-Type header (default: `application/json`)
  - `accept` (String): Accept header (default: `application/json`)
  - `userAgent` (String): User-Agent header (default: `BugSpotter/1.0`)
  - `customHeaders` (Object): Additional headers
  - `timeout` (Number): Request timeout in ms (default: 10000)
  - `errorPrefix` (String): Error message prefix (default: `API request failed`)

**Returns**: `Promise<any>` - Parsed response body

**Throws**: `PluginError` with `ERROR_CODES.NETWORK_ERROR`

**Examples**:

```javascript
// GET request
const issues = await utils.makeApiRequest({
  baseUrl: 'https://api.github.com',
  endpoint: '/repos/owner/repo/issues',
  method: 'GET',
  authHeader: await utils.buildAuthHeader({
    type: 'bearer',
    token: config.githubToken,
  }),
});

// POST request with body
const newIssue = await utils.makeApiRequest({
  baseUrl: config.jiraUrl,
  endpoint: '/rest/api/3/issue',
  method: 'POST',
  authHeader: await utils.buildAuthHeader({
    type: 'basic',
    username: config.jiraEmail,
    password: config.jiraApiToken,
  }),
  body: {
    fields: {
      project: { key: 'BUG' },
      summary: bugReport.title,
      issuetype: { name: 'Bug' },
    },
  },
  errorPrefix: 'Failed to create Jira ticket',
});

// Custom headers and content type
const result = await utils.makeApiRequest({
  baseUrl: 'https://api.linear.app',
  endpoint: '/graphql',
  method: 'POST',
  customHeaders: {
    'X-Linear-Client': 'BugSpotter/1.0',
  },
  authHeader: await utils.buildAuthHeader({
    type: 'bearer',
    token: config.linearApiKey,
  }),
  body: JSON.stringify({
    query: 'mutation { issueCreate(...) }',
  }),
});
```

### `utils.buildUrl(baseUrl, endpoint, queryParams)`

Build URLs with query parameters safely.

**Parameters**:

- `baseUrl` (String): Base URL
- `endpoint` (String): Endpoint path
- `queryParams` (Object): Optional query parameters (null values skipped)

**Returns**: `Promise<string>` - Complete URL with query string

**Examples**:

```javascript
// Simple URL
const url = await utils.buildUrl('https://api.github.com', '/repos/owner/repo/issues', {
  state: 'open',
  page: 1,
});
// Returns: "https://api.github.com/repos/owner/repo/issues?state=open&page=1"

// Null values are skipped
const url = await utils.buildUrl('https://api.example.com', '/search', {
  q: 'bug',
  filter: null,
  limit: 10,
});
// Returns: "https://api.example.com/search?q=bug&limit=10"
```

---

## Storage

### `utils.getResourceUrls(bugReport)`

Get presigned URLs for all available bug report resources (screenshots, replays, videos, logs).

**Parameters**:

- `bugReport` (Object): Bug report object with resource fields
  - `project_id` (String): Project ID (required)
  - `screenshot_url` (String): Screenshot storage path
  - `replay_url` (String): Session replay storage path
  - `video_url` (String): Video storage path
  - `logs_url` (String): Logs storage path

**Returns**: `Promise<Object>` - Object with presigned URLs for available resources

**Examples**:

```javascript
// Get all available resource URLs
const urls = await utils.getResourceUrls(bugReport);
// Returns: {
//   screenshot: "https://storage.example.com/...",
//   replay: "https://storage.example.com/...",
//   // Only includes resources that exist
// }

// Use in ticket description
if (urls.screenshot) {
  description += `\n\n[View Screenshot](${urls.screenshot})`;
}
if (urls.replay) {
  description += `\n[View Session Replay](${urls.replay})`;
}
```

---

## Metadata Extraction

### `utils.extractEnvironment(metadata)`

Extract structured environment data from bug report metadata.

**Parameters**:

- `metadata` (Object): Bug report metadata (optional)

**Returns**: `Promise<Object>` - Environment object with defaults for missing fields

- `browser` (String)
- `browserVersion` (String)
- `os` (String)
- `osVersion` (String)
- `viewport` (String)
- `url` (String)
- `userAgent` (String)

**Examples**:

```javascript
const env = await utils.extractEnvironment(bugReport.metadata);
// Returns: {
//   browser: "Chrome",
//   browserVersion: "120.0.0",
//   os: "Windows",
//   osVersion: "11",
//   viewport: "1920x1080",
//   url: "https://example.com/page",
//   userAgent: "Mozilla/5.0..."
// }

// Use in ticket
const description = `
**Environment:**
- Browser: ${env.browser} ${env.browserVersion}
- OS: ${env.os} ${env.osVersion}
- URL: ${env.url}
`;
```

### `utils.extractConsoleLogs(metadata, limit)`

Extract console logs from metadata (most recent entries).

**Parameters**:

- `metadata` (Object): Bug report metadata (optional)
- `limit` (Number): Maximum logs to return (default: 10)

**Returns**: `Promise<Array>` - Array of console log objects

- `level` (String): `'log'`, `'error'`, `'warn'`, `'info'`
- `message` (String): Log message
- `timestamp` (String): ISO timestamp

**Examples**:

```javascript
const logs = await utils.extractConsoleLogs(bugReport.metadata, 5);
// Returns: [
//   { level: "error", message: "Failed to fetch data", timestamp: "2025-01-01T..." },
//   { level: "warn", message: "Deprecated API used", timestamp: "2025-01-01T..." }
// ]

// Format for ticket
if (logs.length > 0) {
  let logsText = logs.map((log) => `[${log.level}] ${log.message}`).join('\n');
  description += `\n\n**Console Logs:**\n\`\`\`\n${logsText}\n\`\`\``;
}
```

### `utils.extractNetworkErrors(metadata)`

Extract failed network requests (status >= 400).

**Parameters**:

- `metadata` (Object): Bug report metadata (optional)

**Returns**: `Promise<Array>` - Array of failed request objects

- `method` (String): HTTP method
- `url` (String): Request URL
- `status` (Number): HTTP status code
- `statusText` (String): Status text

**Examples**:

```javascript
const errors = await utils.extractNetworkErrors(bugReport.metadata);
// Returns: [
//   { method: "GET", url: "/api/data", status: 404, statusText: "Not Found" },
//   { method: "POST", url: "/api/submit", status: 500, statusText: "Internal Server Error" }
// ]

// Format for ticket
if (errors.length > 0) {
  let errorText = errors
    .map((e) => `${e.method} ${e.url} - ${e.status} ${e.statusText}`)
    .join('\n');
  description += `\n\n**Failed Requests:**\n${errorText}`;
}
```

---

## Validation

### `validators` (Global Constant)

Object containing validator names for use with `validateFields`.

**Available validators**:

- `validators.required` - Field is required and non-empty
- `validators.url` - Valid URL format
- `validators.email` - Valid email format
- `validators.pattern` - Matches regex pattern
- `validators.oneOf` - Value in allowed list
- `validators.length` - String length within range
- `validators.range` - Number within range

**Usage**: Pass validator names to `validateFields` - they'll be resolved to functions via RPC.

### `utils.validateFields(fields)`

Validate multiple fields and collect errors.

**Parameters**:

- `fields` (Array): Array of field validation objects
  - `name` (String): Field name for error messages
  - `value` (any): Value to validate
  - `validator` (String): Validator name from `validators` object

**Returns**: `Promise<Array<string>>` - Array of error messages (empty if valid)

**Examples**:

```javascript
// Basic validation
const errors = await utils.validateFields([
  { name: 'API URL', value: config.apiUrl, validator: validators.required },
  { name: 'API URL', value: config.apiUrl, validator: validators.url },
  { name: 'API Key', value: config.apiKey, validator: validators.required },
]);

if (errors.length > 0) {
  throw await utils.createPluginError(ERROR_CODES.VALIDATION_ERROR, errors.join('; '));
}

// Multiple validators for same field
async function validateConfig(config) {
  const fields = [];

  // Jira URL
  fields.push(
    { name: 'Jira URL', value: config.jiraUrl, validator: validators.required },
    { name: 'Jira URL', value: config.jiraUrl, validator: validators.url }
  );

  // Project key
  fields.push({ name: 'Project key', value: config.projectKey, validator: validators.required });

  // Email (basic auth)
  if (config.auth?.type === 'basic') {
    fields.push(
      { name: 'Email', value: config.auth.email, validator: validators.required },
      { name: 'Email', value: config.auth.email, validator: validators.email }
    );
  }

  const errors = await utils.validateFields(fields);
  return await utils.createValidationResult(errors.length === 0, errors);
}
```

### `utils.createValidationResult(isValid, errors)`

Create standardized validation result object.

**Parameters**:

- `isValid` (Boolean): Whether validation passed
- `errors` (Array): Array of error strings (optional)

**Returns**: `Promise<Object>` - Validation result

- `valid` (Boolean): Validation status
- `errors` (Array): Error messages
- `message` (String): Combined error message (if errors exist)

**Examples**:

```javascript
// Successful validation
const result = await utils.createValidationResult(true, []);
// Returns: { valid: true, errors: [] }

// Failed validation
const result = await utils.createValidationResult(false, [
  'API URL is required',
  'Project key is required',
]);
// Returns: {
//   valid: false,
//   errors: ['API URL is required', 'Project key is required'],
//   message: 'API URL is required; Project key is required'
// }
```

---

## Error Handling

### `ERROR_CODES` (Global Constant)

Standard error codes for plugin operations.

**Available codes**:

- `ERROR_CODES.AUTH_FAILED` - Authentication/authorization failed
- `ERROR_CODES.NETWORK_ERROR` - Network request failed
- `ERROR_CODES.INVALID_CONFIG` - Invalid configuration
- `ERROR_CODES.RESOURCE_NOT_FOUND` - Resource not found
- `ERROR_CODES.RATE_LIMIT` - Rate limit exceeded
- `ERROR_CODES.TIMEOUT` - Operation timeout
- `ERROR_CODES.VALIDATION_ERROR` - Validation failed
- `ERROR_CODES.UNKNOWN_ERROR` - Unknown error

### `utils.createPluginError(code, message, details)`

Create standardized plugin error.

**Parameters**:

- `code` (String): Error code from `ERROR_CODES`
- `message` (String): Human-readable error message
- `details` (Object): Additional error context (optional)

**Returns**: `Promise<Object>` - PluginError object

- `name` (String): `'PluginError'`
- `message` (String): Error message
- `code` (String): Error code
- `details` (Object): Error details

**Examples**:

```javascript
// Authentication error
if (response.status === 401) {
  throw await utils.createPluginError(ERROR_CODES.AUTH_FAILED, 'Invalid Jira credentials', {
    statusCode: 401,
    endpoint: '/rest/api/3/myself',
  });
}

// Rate limit error
if (response.status === 429) {
  throw await utils.createPluginError(ERROR_CODES.RATE_LIMIT, 'Jira API rate limit exceeded', {
    statusCode: 429,
    retryAfter: response.headers.get('Retry-After'),
    limit: response.headers.get('X-RateLimit-Limit'),
  });
}

// Validation error
const errors = await utils.validateFields(fields);
if (errors.length > 0) {
  throw await utils.createPluginError(
    ERROR_CODES.VALIDATION_ERROR,
    'Configuration validation failed',
    { errors }
  );
}
```

---

## Retry Logic

**Note**: Retry utilities are available in the library but not currently exposed via RPC bridge. They can be implemented directly in plugin code if needed.

---

## Complete Example: Jira Plugin

```javascript
module.exports = {
  metadata: {
    name: 'jira-integration',
    platform: 'jira',
    version: '1.0.0',
    description: 'Jira Cloud integration using plugin utils',
    author: 'BugSpotter',
  },

  factory: (context) => ({
    createTicket: async (bugReport, projectId, integrationId) => {
      try {
        const { config } = context;

        // Get resource URLs
        const urls = await utils.getResourceUrls(bugReport);

        // Extract metadata
        const env = await utils.extractEnvironment(bugReport.metadata);
        const consoleLogs = await utils.extractConsoleLogs(bugReport.metadata, 10);
        const networkErrors = await utils.extractNetworkErrors(bugReport.metadata);

        // Build description with all context
        let description = bugReport.description || 'No description provided';

        // Add attachments
        if (urls.screenshot || urls.replay) {
          description += '\n\n**Attachments:**\n';
          if (urls.screenshot) description += `- [Screenshot](${urls.screenshot})\n`;
          if (urls.replay) description += `- [Session Replay](${urls.replay})\n`;
        }

        // Add environment
        description += `\n\n**Environment:**\n`;
        description += `- Browser: ${env.browser} ${env.browserVersion}\n`;
        description += `- OS: ${env.os}\n`;
        description += `- URL: ${env.url}\n`;

        // Add console logs if present
        if (consoleLogs.length > 0) {
          const logsText = consoleLogs.map((log) => `[${log.level}] ${log.message}`).join('\n');
          description += `\n\n**Console Logs:**\n\`\`\`\n${logsText}\n\`\`\``;
        }

        // Create ticket using makeApiRequest
        const authHeader = await utils.buildAuthHeader({
          type: 'basic',
          username: config.jiraEmail,
          password: config.jiraApiToken,
        });

        const result = await utils.makeApiRequest({
          baseUrl: config.jiraUrl,
          endpoint: '/rest/api/3/issue',
          method: 'POST',
          authHeader,
          body: {
            fields: {
              project: { key: config.projectKey },
              summary: bugReport.title,
              description: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: description }],
                  },
                ],
              },
              issuetype: { name: 'Bug' },
              priority: { name: config.priority || 'Medium' },
            },
          },
          errorPrefix: 'Failed to create Jira ticket',
        });

        return {
          success: true,
          external_id: result.key,
          external_url: `${config.jiraUrl}/browse/${result.key}`,
        };
      } catch (error) {
        return {
          success: false,
          external_id: '',
          error: error.message,
        };
      }
    },

    testConnection: async (projectId) => {
      try {
        const { config } = context;

        // Test authentication
        const authHeader = await utils.buildAuthHeader({
          type: 'basic',
          username: config.jiraEmail,
          password: config.jiraApiToken,
        });

        await utils.makeApiRequest({
          baseUrl: config.jiraUrl,
          endpoint: '/rest/api/3/myself',
          method: 'GET',
          authHeader,
          errorPrefix: 'Jira authentication failed',
        });

        return true;
      } catch (error) {
        return false;
      }
    },

    validateConfig: async (config) => {
      const errors = await utils.validateFields([
        { name: 'Jira URL', value: config.jiraUrl, validator: validators.required },
        { name: 'Jira URL', value: config.jiraUrl, validator: validators.url },
        { name: 'Project Key', value: config.projectKey, validator: validators.required },
        { name: 'Email', value: config.jiraEmail, validator: validators.required },
        { name: 'Email', value: config.jiraEmail, validator: validators.email },
        { name: 'API Token', value: config.jiraApiToken, validator: validators.required },
      ]);

      return await utils.createValidationResult(errors.length === 0, errors);
    },
  }),
};
```

---

## Migration Guide

### Before (Without Plugin Utils):

```javascript
// Manually build auth header
const credentials = config.jiraEmail + ':' + config.jiraApiToken;
const authHeader = 'Basic ' + Buffer.from(credentials).toString('base64');

// Manual error handling
const response = await context.http.fetch(url, { method: 'POST', body: '...' });
if (response.status !== 200) {
  const errorBody = await response.text();
  throw new Error('Failed: ' + errorBody);
}
const data = await response.json();

// Manual validation
if (!config.jiraUrl) throw new Error('URL required');
if (!config.jiraUrl.startsWith('http')) throw new Error('Invalid URL');
```

### After (With Plugin Utils):

```javascript
// Use helper
const authHeader = await utils.buildAuthHeader({
  type: 'basic',
  username: config.jiraEmail,
  password: config.jiraApiToken
});

// Simplified request with automatic error handling
const data = await utils.makeApiRequest({
  baseUrl: config.jiraUrl,
  endpoint: '/rest/api/3/issue',
  method: 'POST',
  authHeader,
  body: { fields: {...} }
});

// Reusable validators
const errors = await utils.validateFields([
  { name: 'Jira URL', value: config.jiraUrl, validator: validators.required },
  { name: 'Jira URL', value: config.jiraUrl, validator: validators.url }
]);
```

**Benefits**: 44% less code, consistent error handling, reusable across all integrations.

---

## Best Practices

1. **Always use `utils.makeApiRequest`** instead of raw `context.http.fetch` - provides SSRF protection, error handling, and parsing
2. **Validate all config fields** using `utils.validateFields` - prevents runtime errors
3. **Use `ERROR_CODES` constants** for consistent error handling
4. **Extract metadata** with utils helpers instead of manual parsing
5. **Get presigned URLs** for attachments before building ticket descriptions
6. **Test authentication** in `testConnection` using `utils.makeApiRequest`

---

## Support

For issues or feature requests, see [INTEGRATION_MANAGEMENT.md](./INTEGRATION_MANAGEMENT.md) or contact the BugSpotter team.
