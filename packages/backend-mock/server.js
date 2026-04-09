import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Directory for saving bug reports
const REPORTS_DIR = path.join(__dirname, 'bug-reports');
const DB_FILE = path.join(__dirname, 'db.json');

// Ensure reports directory exists
try {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to create reports directory:', err);
}

// Load or initialize database
let db = { bugs: [], nextId: 1 };
try {
  const dbData = await fs.readFile(DB_FILE, 'utf-8');
  db = JSON.parse(dbData);
  console.log(`📂 Loaded ${db.bugs.length} existing bug reports from database`);
} catch (err) {
  // File doesn't exist yet, will be created on first write
  console.log('📂 No existing database found, starting fresh', err.code || '');
}

// Save database to file
async function saveDatabase() {
  try {
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
  } catch (_err) {
    console.error('Failed to save database:', _err);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large screenshots
app.use(express.urlencoded({ extended: true }));

// Mock token storage (in production, use database)
const mockTokens = {
  // API Keys
  'demo-api-key-12345': { type: 'apiKey', valid: true },
  'test-api-key': { type: 'apiKey', valid: true },

  // Bearer Tokens (access tokens)
  'demo-access-token-12345': { type: 'bearer', valid: true, expiresAt: null },
  'expired-token-will-trigger-401': {
    type: 'bearer',
    valid: false,
    expiresAt: Date.now() - 3600000,
  },

  // OAuth Tokens
  'oauth-access-token': { type: 'oauth', valid: true, clientId: 'demo-client-id' },
};

// Mock refresh tokens
const mockRefreshTokens = {
  'demo-refresh-token-67890': { accessToken: 'demo-access-token-12345', valid: true },
  'valid-refresh-token': { accessToken: 'new-access-token', valid: true },
};

// Authentication middleware
function authenticateRequest(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];
  const customAuthHeader = req.headers['x-custom-auth'];

  console.log('🔐 Authentication Check:');

  // Check for custom headers first
  if (customAuthHeader) {
    console.log(`  ✓ Custom Auth Header: ${customAuthHeader}`);
    req.authType = 'custom';
    return next();
  }

  // Check for API Key in custom header
  if (apiKeyHeader) {
    console.log(`  ✓ API Key Header: ${apiKeyHeader}`);
    const tokenData = mockTokens[apiKeyHeader];
    if (tokenData && tokenData.valid) {
      req.authType = 'apiKey';
      req.authenticated = true;
      return next();
    } else {
      console.log('  ✗ Invalid API Key');
      return res.status(401).json({ error: 'Invalid API key' });
    }
  }

  // Check for Bearer token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    console.log(`  ✓ Bearer Token: ${token.substring(0, 20)}...`);

    const tokenData = mockTokens[token];
    if (!tokenData) {
      console.log('  ✗ Unknown token');
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token not recognized',
      });
    }

    // Check if token is expired
    if (!tokenData.valid || (tokenData.expiresAt && tokenData.expiresAt < Date.now())) {
      console.log('  ✗ Token expired - refresh required');
      return res.status(401).json({
        error: 'Token expired',
        message: 'Access token has expired. Please refresh.',
        code: 'TOKEN_EXPIRED',
      });
    }

    console.log(`  ✓ Valid ${tokenData.type} token`);
    req.authType = tokenData.type;
    req.authenticated = true;
    return next();
  }

  // No authentication provided
  console.log('  ⚠️  No authentication provided (allowing for demo)');
  req.authType = 'none';
  req.authenticated = false;
  next();
}

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${req.method} ${req.path}`);
  if (req.headers.authorization) {
    console.log(`  Authorization: ${req.headers.authorization.substring(0, 50)}...`);
  }
  if (req.headers['x-api-key']) {
    console.log(`  X-API-Key: ${req.headers['x-api-key']}`);
  }
  if (req.headers['x-custom-auth']) {
    console.log(`  X-Custom-Auth: ${req.headers['x-custom-auth']}`);
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Token refresh endpoint (for Bearer Token auth)
app.post('/api/auth/refresh', (req, res) => {
  console.log('\n🔄 Token Refresh Request');
  console.log('─────────────────────────────────────');

  const { refreshToken } = req.body;

  if (!refreshToken) {
    console.log('✗ No refresh token provided');
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  console.log(`Refresh Token: ${refreshToken.substring(0, 30)}...`);

  const tokenData = mockRefreshTokens[refreshToken];

  if (!tokenData || !tokenData.valid) {
    console.log('✗ Invalid refresh token');
    return res.status(401).json({
      error: 'Invalid refresh token',
      message: 'Refresh token is invalid or expired',
    });
  }

  // Generate new tokens
  const newAccessToken = `refreshed-token-${Date.now()}`;
  const newRefreshToken = `new-refresh-${Date.now()}`;

  // Store new tokens (in production, this would be in database)
  mockTokens[newAccessToken] = { type: 'bearer', valid: true, expiresAt: Date.now() + 3600000 };
  mockRefreshTokens[newRefreshToken] = { accessToken: newAccessToken, valid: true };

  console.log('✓ Tokens refreshed successfully');
  console.log(`✓ New Access Token: ${newAccessToken}`);
  console.log(`✓ New Refresh Token: ${newRefreshToken}`);
  console.log('─────────────────────────────────────\n');

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: 3600,
    tokenType: 'Bearer',
  });
});

// OAuth token endpoint (for OAuth flow)
app.post('/api/auth/token', (req, res) => {
  console.log('\n🔐 OAuth Token Request');
  console.log('─────────────────────────────────────');

  const { grant_type, client_id, client_secret, refresh_token } = req.body;

  console.log(`Grant Type: ${grant_type}`);
  console.log(`Client ID: ${client_id}`);

  if (grant_type === 'client_credentials') {
    // OAuth client credentials flow
    if (client_id !== 'demo-client-id' || client_secret !== 'demo-client-secret') {
      console.log('✗ Invalid client credentials');
      return res.status(401).json({ error: 'Invalid client credentials' });
    }

    const accessToken = `oauth-token-${Date.now()}`;
    mockTokens[accessToken] = { type: 'oauth', valid: true, clientId: client_id };

    console.log('✓ OAuth token issued');
    console.log(`✓ Access Token: ${accessToken}`);
    console.log('─────────────────────────────────────\n');

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }

  if (grant_type === 'refresh_token') {
    // OAuth refresh token flow
    const tokenData = mockRefreshTokens[refresh_token];

    if (!tokenData || !tokenData.valid) {
      console.log('✗ Invalid refresh token');
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const newAccessToken = `oauth-refreshed-${Date.now()}`;
    const newRefreshToken = `oauth-refresh-${Date.now()}`;

    mockTokens[newAccessToken] = { type: 'oauth', valid: true, clientId: client_id };
    mockRefreshTokens[newRefreshToken] = { accessToken: newAccessToken, valid: true };

    console.log('✓ OAuth tokens refreshed');
    console.log('─────────────────────────────────────\n');

    return res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }

  console.log('✗ Unsupported grant type');
  res.status(400).json({ error: 'Unsupported grant type' });
});

// Get all bug reports
app.get('/api/bugs', (req, res) => {
  console.log(`Returning ${db.bugs.length} bug reports`);
  res.json({
    total: db.bugs.length,
    bugs: db.bugs,
  });
});

// Get single bug report
app.get('/api/bugs/:id', (req, res) => {
  const bug = db.bugs.find((b) => {
    return b.id === req.params.id;
  });
  if (!bug) {
    return res.status(404).json({ error: 'Bug report not found' });
  }
  res.json(bug);
});

// Submit bug report
app.post('/api/bugs', authenticateRequest, async (req, res) => {
  console.log('\n📝 Bug Report Received!');
  console.log('─────────────────────────────────────');
  console.log(`Auth Type: ${req.authType || 'none'}`);
  console.log(`Authenticated: ${req.authenticated ? 'Yes' : 'No'}`);

  const { title, description, report, priority } = req.body;

  // Validate required fields
  if (!title || !description) {
    console.log('✗ Missing required fields');
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: 'Title and description are required',
    });
  }

  // Validate title length
  if (title.length > 200) {
    console.log('✗ Title too long');
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: 'Title must be 200 characters or less',
    });
  }

  if (!report) {
    console.log('✗ Missing report data');
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: 'Report data is required',
    });
  }

  // Validate metadata is present
  if (!report.metadata || typeof report.metadata !== 'object') {
    console.log('✗ Missing metadata');
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: 'Report metadata is required',
    });
  }

  // Validate console log levels
  const validLogLevels = ['log', 'warn', 'error', 'info', 'debug'];
  if (report.console && Array.isArray(report.console)) {
    for (const log of report.console) {
      if (log.level && !validLogLevels.includes(log.level)) {
        console.log(`✗ Invalid console log level: ${log.level}`);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          details: `Invalid console log level: ${log.level}`,
        });
      }
    }
  }

  // Validate network request methods
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  if (report.network && Array.isArray(report.network)) {
    for (const req of report.network) {
      if (req.method && !validMethods.includes(req.method)) {
        console.log(`✗ Invalid network method: ${req.method}`);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          details: `Invalid network method: ${req.method}`,
        });
      }
      // Validate URL format
      if (req.url) {
        try {
          new globalThis.URL(req.url);
        } catch (e) {
          console.log(`✗ Invalid network URL: ${req.url} - ${e.message}`);
          return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: `Invalid network request URL: ${req.url}`,
          });
        }
      }
    }
  }

  // Validate priority if provided
  const validPriorities = ['low', 'medium', 'high', 'critical'];
  if (priority && !validPriorities.includes(priority)) {
    console.log(`✗ Invalid priority: ${priority}`);
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: `Invalid priority: ${priority}`,
    });
  }

  // Create bug report record
  const bugId = `bug-${db.nextId++}`;
  const bugReport = {
    id: bugId,
    title,
    description,
    priority: priority || 'medium',
    status: 'open',
    report: {
      screenshot: report.screenshot?.substring(0, 50) + '...', // Truncate for display
      console: report.console,
      network: report.network,
      metadata: report.metadata,
      replay: report.replay,
    },
    created_at: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  db.bugs.push(bugReport);

  // Save database
  await saveDatabase();

  // Save to file
  const filename = `bug-${bugId}-${Date.now()}.json`;
  const filepath = path.join(REPORTS_DIR, filename);

  try {
    await fs.writeFile(
      filepath,
      JSON.stringify(
        {
          id: bugId,
          title,
          description,
          report,
          receivedAt: bugReport.receivedAt,
        },
        null,
        2
      )
    );
    console.log(`💾 Saved to: ${filename}`);
  } catch (err) {
    console.error('Failed to save report to file:', err.message);
  }

  // Log summary
  console.log(`✓ Title: ${title}`);
  console.log(
    `✓ Description: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`
  );
  console.log(`✓ Console Logs: ${report.console?.length || 0} entries`);
  console.log(`✓ Network Requests: ${report.network?.length || 0} requests`);
  console.log(`✓ Screenshot: ${report.screenshot ? 'Captured' : 'Not available'}`);

  // Session Replay info
  if (report.replay && report.replay.length > 0) {
    const timeSpan = (
      (report.replay[report.replay.length - 1].timestamp - report.replay[0].timestamp) /
      1000
    ).toFixed(2);
    const eventTypes = [
      ...new Set(
        report.replay.map((e) => {
          return e.type;
        })
      ),
    ];
    console.log(`✓ Session Replay: ${report.replay.length} events (${timeSpan}s span)`);
    console.log(`  Event Types: ${eventTypes.join(', ')}`);
  } else {
    console.log(`✓ Session Replay: Not available`);
  }

  console.log(`✓ Browser: ${report.metadata?.browser || 'Unknown'}`);
  console.log(`✓ OS: ${report.metadata?.os || 'Unknown'}`);
  console.log(`✓ URL: ${report.metadata?.url || 'Unknown'}`);
  console.log(
    `✓ Viewport: ${report.metadata?.viewport?.width}x${report.metadata?.viewport?.height}`
  );

  // Log detailed console entries
  if (report.console && report.console.length > 0) {
    console.log('\n📋 Console Logs:');
    report.console.slice(0, 10).forEach((log, index) => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const level = log.level.toUpperCase().padEnd(5);
      const message = log.message.substring(0, 80);
      console.log(
        `  ${index + 1}. [${time}] ${level} ${message}${log.message.length > 80 ? '...' : ''}`
      );
    });
    if (report.console.length > 10) {
      console.log(`  ... and ${report.console.length - 10} more entries`);
    }
  }

  // Log detailed network requests
  if (report.network && report.network.length > 0) {
    console.log('\n🌐 Network Requests:');
    report.network.slice(0, 5).forEach((req, index) => {
      const method = req.method.padEnd(6);
      const status = req.status ? `${req.status}` : 'FAIL';
      const duration = req.duration ? `${req.duration}ms` : 'N/A';
      const url = req.url.length > 60 ? req.url.substring(0, 57) + '...' : req.url;
      console.log(`  ${index + 1}. ${method} ${status.padEnd(4)} ${duration.padEnd(6)} ${url}`);
    });
    if (report.network.length > 5) {
      console.log(`  ... and ${report.network.length - 5} more requests`);
    }
  }

  // Log session replay details
  if (report.replay && report.replay.length > 0) {
    console.log('\n🎥 Session Replay Events:');
    const timeSpan = (
      (report.replay[report.replay.length - 1].timestamp - report.replay[0].timestamp) /
      1000
    ).toFixed(2);
    const eventTypeCounts = {};
    report.replay.forEach((e) => {
      eventTypeCounts[e.type] = (eventTypeCounts[e.type] || 0) + 1;
    });

    console.log(`  Total Events: ${report.replay.length}`);
    console.log(`  Time Span: ${timeSpan} seconds`);
    console.log(`  First Event: ${new Date(report.replay[0].timestamp).toLocaleTimeString()}`);
    console.log(
      `  Last Event: ${new Date(report.replay[report.replay.length - 1].timestamp).toLocaleTimeString()}`
    );
    console.log(`  Event Type Breakdown:`);
    Object.entries(eventTypeCounts).forEach(([type, count]) => {
      const typeName =
        {
          0: 'DomContentLoaded',
          1: 'Load',
          2: 'FullSnapshot',
          3: 'IncrementalSnapshot',
          4: 'Meta',
          5: 'Custom',
          6: 'Plugin',
        }[type] || `Type${type}`;
      console.log(`    ${typeName}: ${count}`);
    });
  }

  console.log('─────────────────────────────────────');
  console.log(`✓ Bug Report ID: ${bugId}`);
  console.log(`✓ Total Reports: ${db.bugs.length}\n`);

  // Simulate processing delay (optional)
  const simulateDelay = req.query.delay ? parseInt(req.query.delay) : 0;

  globalThis.setTimeout(() => {
    res.status(201).json({
      success: true,
      data: {
        id: bugId,
        title,
        description,
        priority: priority || 'medium',
        status: 'open',
        created_at: bugReport.created_at,
      },
      timestamp: new Date().toISOString(),
    });
  }, simulateDelay);
});

// Simulate error responses for testing
app.post('/api/bugs/error/:code', (req, res) => {
  const code = parseInt(req.params.code);
  const errorMessages = {
    400: 'Bad Request - Invalid payload',
    401: 'Unauthorized - Invalid API key',
    403: 'Forbidden - Access denied',
    404: 'Not Found - Endpoint does not exist',
    500: 'Internal Server Error - Something went wrong',
    503: 'Service Unavailable - Server is temporarily unavailable',
  };

  console.log(`\n✗ Simulating ${code} error`);
  res.status(code).json({
    error: errorMessages[code] || 'Unknown error',
    timestamp: new Date().toISOString(),
  });
});

// Delete all bug reports (for testing)
app.delete('/api/bugs', async (req, res) => {
  const count = db.bugs.length;
  db.bugs = [];
  db.nextId = 1;
  await saveDatabase();
  console.log(`\n🗑️  Deleted ${count} bug reports`);
  res.json({ success: true, deleted: count });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│   BugSpotter Mock API Server Started   │');
  console.log('└─────────────────────────────────────────┘\n');
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Submit bugs: POST http://localhost:${PORT}/api/bugs`);
  console.log(`📋 View bugs: GET http://localhost:${PORT}/api/bugs`);
  console.log('\n⏳ Waiting for bug reports...\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down server...');
  process.exit(0);
});
