/**
 * E2E Integration Test: Shared Replay Workflow
 * Tests the complete flow: Bug report → Replay upload → Share token → View shared replay
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import { createServer } from '../../src/api/server.js';
import {
  createMockStorage,
  createMockPluginRegistry,
  createMockQueueManager,
} from '../test-helpers.js';
import { hashPassword } from '../../src/utils/token-generator.js';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Project, User } from '../../src/db/types.js';

describe('E2E: Shared Replay Workflow', () => {
  let db: DatabaseClient;
  let server: FastifyInstance;
  let testProject: Project;
  let testUser: User;
  let authToken: string;

  beforeAll(async () => {
    db = createDatabaseClient();

    const storage = createMockStorage();
    const pluginRegistry = createMockPluginRegistry();
    const queueManager = createMockQueueManager();

    server = await createServer({ db, storage, pluginRegistry, queueManager });

    // Hash password for test user
    const passwordHash = await hashPassword('test-password-123');

    // Create test user
    testUser = await db.users.create({
      email: 'e2e-test@example.com',
      password_hash: passwordHash,
      name: 'E2E Test User',
    });

    // Create test project
    testProject = await db.projects.create({
      name: 'E2E Test Project',
      created_by: testUser.id,
    });

    // Add user to project
    await db.projectMembers.create({
      project_id: testProject.id,
      user_id: testUser.id,
      role: 'owner',
    });

    // Login to get auth token
    const loginResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUser.email,
        password: 'test-password-123',
      },
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginData = JSON.parse(loginResponse.body);
    authToken = loginData.data.access_token;
  });

  afterAll(async () => {
    // Cleanup
    if (testProject?.id) await db.projects.delete(testProject.id);
    if (testUser?.id) await db.users.delete(testUser.id);
    await server.close();
    await db.close();
  });

  it('should complete full workflow: report bug → upload replay → create share token → view shared replay', async () => {
    // ============================================================================
    // STEP 1: Create Bug Report
    // ============================================================================
    console.log('\n📝 STEP 1: Creating bug report...');

    const bugReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'E2E Test Bug',
      description: 'Testing shared replay workflow',
      priority: 'medium',
      status: 'open',
      metadata: {
        browser: 'Chrome 120',
        os: 'Windows 11',
        viewport: { width: 1920, height: 1080 },
        url: 'https://example.com/app',
        timestamp: Date.now(),
        userAgent: 'Mozilla/5.0...',
        console: [
          {
            level: 'error',
            message: 'Uncaught TypeError: Cannot read property',
            timestamp: Date.now(),
          },
        ],
        network: [
          {
            method: 'GET',
            url: '/api/data',
            status: 500,
            timestamp: Date.now(),
          },
        ],
      },
    });

    console.log(`✅ Bug report created: ${bugReport.id}`);
    expect(bugReport.id).toBeDefined();
    expect(bugReport.replay_key).toBeNull(); // No replay yet

    // ============================================================================
    // STEP 2: Simulate Replay Upload
    // ============================================================================
    console.log('\n🎥 STEP 2: Simulating replay upload...');

    // Bypass API and directly update database (since mock storage doesn't actually store files)
    const replayKey = `replays/${testProject.id}/${bugReport.id}/session.json.gz`;
    await db.bugReports.update(bugReport.id, {
      replay_key: replayKey,
      replay_upload_status: 'completed',
    });

    console.log(`✅ Replay simulated: ${replayKey}`);

    // Verify bug report now has replay_key
    const updatedBugReport = await db.bugReports.findById(bugReport.id);
    expect(updatedBugReport?.replay_key).toBeTruthy();
    console.log(`✅ Bug report updated with replay_key: ${updatedBugReport?.replay_key}`);

    // ============================================================================
    // STEP 3: Create Share Token
    // ============================================================================
    console.log('\n🔗 STEP 3: Creating share token...');

    const createShareResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/replays/${bugReport.id}/share`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        expires_in_hours: 24,
        password: 'test-password-123',
      },
    });

    console.log(`Create share token response: ${createShareResponse.statusCode}`);
    expect(createShareResponse.statusCode).toBe(201);

    const shareData = JSON.parse(createShareResponse.body);
    const shareToken = shareData.data.token;

    console.log(`✅ Share token created: ${shareToken.substring(0, 8)}...`);
    console.log(`   Password protected: ${shareData.data.password_protected}`);
    console.log(`   Expires at: ${shareData.data.expires_at}`);

    // ============================================================================
    // STEP 4: Access Shared Replay (Without Password - Should Fail)
    // ============================================================================
    console.log('\n🔒 STEP 4a: Attempting access without password...');

    const accessNoPasswordResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/replays/shared/${shareToken}`,
    });

    console.log(`Access without password: ${accessNoPasswordResponse.statusCode}`);
    expect(accessNoPasswordResponse.statusCode).toBe(401); // Password required (401 Unauthorized)
    console.log('✅ Correctly rejected - password required');

    // ============================================================================
    // STEP 5: Access Shared Replay (With Correct Password - Should Succeed)
    // ============================================================================
    console.log('\n🎬 STEP 4b: Accessing shared replay with password...');

    const accessResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/replays/shared/${shareToken}?password=test-password-123`,
    });

    console.log(`Access with password: ${accessResponse.statusCode}`);
    expect(accessResponse.statusCode).toBe(200);

    const sharedReplay = JSON.parse(accessResponse.body);
    console.log(`✅ Shared replay accessed successfully!`);
    console.log(`   Bug Report: ${sharedReplay.data.bug_report.title}`);
    console.log(`   Session Type: ${sharedReplay.data.session.events.type}`);
    console.log(
      `   Recorded Events: ${sharedReplay.data.session.events.recordedEvents?.length || 0}`
    );
    console.log(`   View Count: ${sharedReplay.data.share_info.view_count}`);

    // Verify replay data structure
    expect(sharedReplay.data.bug_report.id).toBe(bugReport.id);
    expect(sharedReplay.data.session).toBeDefined();
    expect(sharedReplay.data.session.events).toBeDefined();
    expect(sharedReplay.data.session.events.type).toBe('rrweb');
    expect(sharedReplay.data.session.events.recordedEvents).toBeDefined();
    expect(Array.isArray(sharedReplay.data.session.events.recordedEvents)).toBe(true);
    expect(sharedReplay.data.session.events.recordedEvents.length).toBeGreaterThan(0);
    expect(sharedReplay.data.share_info.view_count).toBe(1);

    // ============================================================================
    // STEP 6: Verify View Count Increments
    // ============================================================================
    console.log('\n👁️ STEP 5: Verifying view count increments...');

    const secondAccessResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/replays/shared/${shareToken}?password=test-password-123`,
    });

    expect(secondAccessResponse.statusCode).toBe(200);
    const secondAccess = JSON.parse(secondAccessResponse.body);
    console.log(
      `✅ Second access successful, view count: ${secondAccess.data.share_info.view_count}`
    );
    expect(secondAccess.data.share_info.view_count).toBe(2);

    // ============================================================================
    // STEP 7: Revoke Share Token
    // ============================================================================
    console.log('\n🚫 STEP 6: Revoking share token...');

    const revokeResponse = await server.inject({
      method: 'DELETE',
      url: `/api/v1/replays/share/${shareToken}`,
      headers: { Authorization: `Bearer ${authToken}` },
    });

    console.log(`Revoke response: ${revokeResponse.statusCode}`);
    expect(revokeResponse.statusCode).toBe(200);
    console.log('✅ Share token revoked');

    // ============================================================================
    // STEP 8: Verify Revoked Token Cannot Be Used
    // ============================================================================
    console.log('\n❌ STEP 7: Verifying revoked token is invalid...');

    const revokedAccessResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/replays/shared/${shareToken}?password=test-password-123`,
    });

    console.log(`Access revoked token: ${revokedAccessResponse.statusCode}`);
    expect(revokedAccessResponse.statusCode).toBe(404);
    console.log('✅ Correctly rejected - token revoked');

    console.log('\n✅ E2E TEST COMPLETE - All steps passed!');
  });

  it('should support metadata-only shared replays (without rrweb recording)', async () => {
    // ============================================================================
    // Test metadata-only workflow (console + network logs only)
    // ============================================================================
    console.log('\n📊 Testing metadata-only shared replay...');

    // Create bug report with metadata but no replay_key
    const metadataOnlyBug = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Metadata-Only Bug',
      description: 'Bug with console and network logs only',
      priority: 'low',
      status: 'open',
      metadata: {
        browser: 'Firefox 121',
        os: 'macOS',
        viewport: { width: 1440, height: 900 },
        url: 'https://example.com/page',
        timestamp: Date.now(),
        console: [
          { level: 'warn', message: 'API deprecated', timestamp: Date.now() },
          { level: 'error', message: 'Network timeout', timestamp: Date.now() },
        ],
        network: [{ method: 'POST', url: '/api/submit', status: 504, timestamp: Date.now() }],
      },
    });

    console.log(`✅ Metadata-only bug created: ${metadataOnlyBug.id}`);

    // Create share token
    const createShareResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/replays/${metadataOnlyBug.id}/share`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { expires_in_hours: 1 },
    });

    expect(createShareResponse.statusCode).toBe(201);
    const { token } = JSON.parse(createShareResponse.body).data;
    console.log(`✅ Share token created for metadata-only bug`);

    // Access shared replay
    const accessResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/replays/shared/${token}`,
    });

    expect(accessResponse.statusCode).toBe(200);
    const sharedData = JSON.parse(accessResponse.body);

    console.log(`✅ Metadata-only replay accessed`);
    console.log(`   Session type: ${sharedData.data.session.events.type}`);
    console.log(`   Console logs: ${sharedData.data.session.events.console.length}`);
    console.log(`   Network requests: ${sharedData.data.session.events.network.length}`);

    // Verify structure
    expect(sharedData.data.session.events.type).toBe('metadata');
    expect(sharedData.data.session.events.recordedEvents).toBeUndefined();
    expect(sharedData.data.session.events.console).toHaveLength(2);
    expect(sharedData.data.session.events.network).toHaveLength(1);

    console.log('✅ Metadata-only test complete!');
  });
});
