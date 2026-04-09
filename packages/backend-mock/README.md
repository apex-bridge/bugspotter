# BugSpotter Mock API Server

⚠️ **For Testing & Development Only**

A lightweight mock API server for testing BugSpotter SDK integration during development. This is **not** intended for production use.

For production deployment, you'll need to implement your own backend API with proper database integration.

## Features

- ✅ Accepts bug report submissions
- ✅ **Multiple authentication methods** (API Key, Bearer Token, OAuth, Custom Headers)
- ✅ **Token refresh endpoint** for testing auto-refresh functionality
- ✅ **OAuth token flow** simulation
- ✅ **401 expired token** simulation for testing
- ✅ **Persistent JSON database** (stores reports across restarts)
- ✅ **Session replay event logging** with type breakdown
- ✅ **Detailed console logging** with formatted output
- ✅ **Network request summary** display
- ✅ **Automatic file saving** to `bug-reports/` directory
- ✅ Supports error simulation
- ✅ CORS enabled for local development

## Quick Start

### Install Dependencies

```bash
pnpm install
```

### Start Server

```bash
pnpm dev
```

The server will start on `http://localhost:3001`

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status.

### Authentication Endpoints

#### Refresh Token (Bearer Token Auth)

```bash
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "demo-refresh-token-67890"
}
```

**Response:**

```json
{
  "accessToken": "refreshed-token-1234567890",
  "refreshToken": "new-refresh-1234567890",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

#### OAuth Token (OAuth Flow)

```bash
POST /api/auth/token
Content-Type: application/json

# Client Credentials Flow
{
  "grant_type": "client_credentials",
  "client_id": "demo-client-id",
  "client_secret": "demo-client-secret"
}

# Refresh Token Flow
{
  "grant_type": "refresh_token",
  "refresh_token": "oauth-refresh-token",
  "client_id": "demo-client-id"
}
```

**Response:**

```json
{
  "access_token": "oauth-token-1234567890",
  "refresh_token": "oauth-refresh-1234567890",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Submit Bug Report

```bash
POST /api/bugs
```

**Authentication Methods:**

1. **API Key**

```bash
POST /api/bugs
X-API-Key: demo-api-key-12345
```

2. **Bearer Token**

```bash
POST /api/bugs
Authorization: Bearer demo-access-token-12345
```

3. **OAuth Token**

```bash
POST /api/bugs
Authorization: Bearer oauth-access-token
```

4. **Custom Headers**

```bash
POST /api/bugs
X-Custom-Auth: custom-auth-value
```

**Headers:**

- `Content-Type: application/json`
- One of the authentication methods above

**Body:**

```json
{
  "title": "Bug title",
  "description": "Bug description",
  "report": {
    "screenshot": "data:image/png;base64,...",
    "console": [...],
    "network": [...],
    "metadata": {...},
    "replay": [...]
  }
}
```

**Response:**

```json
{
  "success": true,
  "bugId": "bug-1",
  "message": "Bug report received successfully",
  "timestamp": "2025-10-06T14:47:00.000Z"
}
```

### Get All Bug Reports

```bash
GET /api/bugs
```

Returns all submitted bug reports.

### Get Single Bug Report

```bash
GET /api/bugs/:id
```

Returns a specific bug report by ID.

### Delete All Bug Reports

```bash
DELETE /api/bugs
```

Clears all bug reports (for testing).

### Simulate Errors

```bash
POST /api/bugs/error/:code
```

Simulates HTTP error responses for testing. Supported codes:

- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable

## Testing with cURL

### Test Authentication Methods

#### 1. API Key Auth

```bash
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo-api-key-12345" \
  -d '{
    "title": "Test Bug with API Key",
    "description": "Testing API Key authentication",
    "report": {
      "screenshot": "data:image/png;base64,test",
      "console": [],
      "network": [],
      "metadata": { "browser": "Chrome", "os": "macOS" }
    }
  }'
```

#### 2. Bearer Token Auth

```bash
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-access-token-12345" \
  -d '{
    "title": "Test Bug with Bearer Token",
    "description": "Testing Bearer Token authentication",
    "report": {
      "screenshot": "data:image/png;base64,test",
      "console": [],
      "network": [],
      "metadata": { "browser": "Chrome", "os": "macOS" }
    }
  }'
```

#### 3. Test Token Refresh

```bash
# First, use an expired token (will get 401)
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer expired-token-will-trigger-401" \
  -d '{"title": "Test", "description": "Test", "report": {}}'

# Then refresh the token
curl -X POST http://localhost:4000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "demo-refresh-token-67890"}'

# Use the new token
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <new-token-from-refresh>" \
  -d '{...}'
```

#### 4. OAuth Flow

```bash
# Get OAuth token (client credentials)
curl -X POST http://localhost:4000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "demo-client-id",
    "client_secret": "demo-client-secret"
  }'

# Use OAuth token to submit bug
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <oauth-token>" \
  -d '{...}'
```

#### 5. Custom Headers

```bash
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "X-Custom-Auth: my-custom-auth-value" \
  -d '{...}'
```

### Submit a bug report:

```bash
curl -X POST http://localhost:4000/api/bugs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-access-token-12345" \
  -d '{
    "title": "Test Bug",
    "description": "This is a test bug report",
    "report": {
      "screenshot": "data:image/png;base64,test",
      "console": [],
      "network": [],
      "metadata": {
        "browser": "Chrome",
        "os": "macOS",
        "url": "http://localhost:3000"
      },
      "replay": []
    }
  }'
```

### View all bugs:

```bash
curl http://localhost:4000/api/bugs
```

### Test error response:

```bash
curl -X POST http://localhost:4000/api/bugs/error/500
```

## Environment Variables

- `PORT` - Server port (default: 4000)

## Mock Authentication Tokens

For testing purposes, the following tokens are pre-configured:

### API Keys

- `demo-api-key-12345` - Valid API key
- `test-api-key` - Valid API key

### Bearer Tokens

- `demo-access-token-12345` - Valid access token
- `expired-token-will-trigger-401` - Expired token (tests refresh flow)

### Refresh Tokens

- `demo-refresh-token-67890` - Valid refresh token
- `valid-refresh-token` - Valid refresh token

### OAuth

- **Client ID**: `demo-client-id`
- **Client Secret**: `demo-client-secret`
- **OAuth Token**: Generated via `/api/auth/token` endpoint

## Testing Token Refresh Flow

1. **Use expired token** → Get 401 error
2. **Call `/api/auth/refresh`** with refresh token
3. **Get new access token** in response
4. **Retry request** with new access token
5. **Success!** ✅

The SDK handles this automatically!

## Notes

- This is a **mock server** for development and testing only
- Data is stored in **JSON file** (`db.json`) and persists across restarts
- Bug reports are also saved to `bug-reports/` directory as individual JSON files
- For production, implement proper database storage and authentication
- All authentication tokens are mocked and not secure
