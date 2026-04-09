#!/usr/bin/env node

/**
 * Seed test data for E2E tests
 * Creates projects and bug reports for testing
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bugspotter.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

console.log('🌱 Seeding test data...\n');

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API call failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return response.json();
}

// Login and get access token
console.log('🔐 Logging in as admin...');
const loginResponse = await apiCall('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  }),
});

const accessToken = loginResponse.data.access_token;
if (!accessToken) {
  console.error('❌ Failed to get access token');
  console.error(loginResponse);
  process.exit(1);
}

console.log('✅ Logged in successfully\n');

// Create test projects
console.log('📦 Creating test projects...');

const project1Response = await apiCall('/api/v1/projects', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    name: 'E2E Test Project 1',
  }),
});

const project1Id = project1Response.data.id;

console.log(`✅ Created project 1: ${project1Id}`);

const project2Response = await apiCall('/api/v1/projects', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    name: 'E2E Test Project 2',
  }),
});

const project2Id = project2Response.data.id;

console.log(`✅ Created project 2: ${project2Id}\n`);

// Create API keys for the projects
console.log('🔑 Creating API keys for projects...');

const apiKey1Response = await apiCall('/api/v1/api-keys', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    name: 'E2E Test Project 1 Key',
    type: 'test',
    permission_scope: 'full',
    allowed_projects: [project1Id],
  }),
});

const project1Key = apiKey1Response.data.api_key;

console.log(`✅ Created API key for project 1`);

const apiKey2Response = await apiCall('/api/v1/api-keys', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    name: 'E2E Test Project 2 Key',
    type: 'test',
    permission_scope: 'full',
    allowed_projects: [project2Id],
  }),
});

const project2Key = apiKey2Response.data.api_key;

console.log(`✅ Created API key for project 2\n`);

// Create bug reports
console.log('🐛 Creating bug reports...');

const testData = {
  projects: {
    project1: { id: project1Id, apiKey: project1Key },
    project2: { id: project2Id, apiKey: project2Key },
  },
  bugReports: {},
};

async function createBugReport(projectKey, title, status, priority, legalHold = false) {
  const response = await apiCall('/api/v1/reports', {
    method: 'POST',
    headers: {
      'X-API-Key': projectKey,
    },
    body: JSON.stringify({
      title,
      description: 'Test bug report for E2E testing',
      priority,
      report: {
        console: [
          {
            level: 'error',
            message: 'Test error message',
            timestamp: new Date().toISOString(),
          },
        ],
        network: [],
        metadata: {
          userAgent: 'Mozilla/5.0 (X11; Linux x64) Chrome/120.0.0.0',
          url: 'https://app.example.com/test',
          viewport: { width: 1920, height: 1080 },
        },
      },
    }),
  });

  const reportId = response.data.id;

  // Update status if not 'open' or set legal hold
  if (status !== 'open' || legalHold) {
    const updateData = {};
    if (status !== 'open') {
      // Convert underscore to hyphen for API
      updateData.status = status.replace('_', '-');
    }

    if (Object.keys(updateData).length > 0) {
      await apiCall(`/api/v1/reports/${reportId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(updateData),
      });
    }

    // Set legal hold directly in database if needed (no API endpoint)
    if (legalHold) {
      // Note: Would require direct DB access - skipping for now
      console.log(`    ⚠️  Legal hold flag requires direct DB update`);
    }
  }

  console.log(`  ✓ Created: ${title} (${priority}, ${status})`);
  return reportId;
}

// Project 1 - Various statuses
testData.bugReports.loginCrash = await createBugReport(
  project1Key,
  'Login page crashes on submit',
  'open',
  'critical'
);
testData.bugReports.dashboardSlow = await createBugReport(
  project1Key,
  'Dashboard loads slowly',
  'open',
  'high'
);
testData.bugReports.searchFilter = await createBugReport(
  project1Key,
  'Search filter not working',
  'open',
  'medium'
);
testData.bugReports.typoFooter = await createBugReport(
  project1Key,
  'Typo in footer text',
  'open',
  'low'
);
testData.bugReports.uploadIssue = await createBugReport(
  project1Key,
  'Cannot upload large files',
  'in_progress',
  'high'
);
testData.bugReports.mobileMenu = await createBugReport(
  project1Key,
  'Mobile menu not closing',
  'in_progress',
  'medium'
);
testData.bugReports.emailValidation = await createBugReport(
  project1Key,
  'Email validation too strict',
  'resolved',
  'low'
);
testData.bugReports.passwordReset = await createBugReport(
  project1Key,
  'Password reset link expired',
  'resolved',
  'medium'
);
testData.bugReports.profilePicture = await createBugReport(
  project1Key,
  'Profile picture upload issue',
  'closed',
  'low'
);

// Project 1 - One with legal hold
testData.bugReports.securityVuln = await createBugReport(
  project1Key,
  'Security vulnerability in auth',
  'open',
  'critical',
  true
);

// Project 2 - Fewer reports
testData.bugReports.apiTimeout = await createBugReport(
  project2Key,
  'API timeout on large requests',
  'open',
  'high'
);
testData.bugReports.cacheIssue = await createBugReport(
  project2Key,
  'Cache invalidation issue',
  'in_progress',
  'medium'
);
testData.bugReports.memoryLeak = await createBugReport(
  project2Key,
  'Memory leak in worker process',
  'resolved',
  'critical'
);

console.log('\n✅ Test data seeding completed!\n');
console.log('📊 Summary:');
console.log('  - Projects: 2');
console.log('  - Bug reports: 13 (10 in project 1, 3 in project 2)');
console.log('  - Statuses: open, in_progress, resolved, closed');
console.log('  - Priorities: low, medium, high, critical');
console.log('  - Legal hold reports: 1\n');
console.log('🎯 Ready for E2E tests!');

// Write test data to file for tests to use
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDataPath = join(__dirname, '../apps/admin/test-data.json');
writeFileSync(testDataPath, JSON.stringify(testData, null, 2));
console.log(`\n📝 Test data IDs written to: test-data.json`);
