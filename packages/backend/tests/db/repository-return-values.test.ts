/**
 * Repository Return Value Tests
 * Tests for update/delete operations that should return affected row counts
 * Added after refactoring to fix void return types (Critical Issue #1)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { User, Project, BugReport } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('Repository Return Values', () => {
  let db: DatabaseClient;
  let testUser: User;
  let testProject: Project;
  let createdUserIds: string[] = [];
  let createdProjectIds: string[] = [];
  let createdIntegrationIds: string[] = [];
  let createdBugReportIds: string[] = [];

  // Track IDs that should only be cleaned up in afterAll, not afterEach
  const permanentBugReportIds = new Set<string>();

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    testUser = await db.users.create({
      email: `test-${Date.now()}@test.com`,
      password_hash: 'hash',
      role: 'user',
    });
    createdUserIds.push(testUser.id);

    testProject = await db.projects.create({
      name: 'Test Project',
      created_by: testUser.id,
    });
    createdProjectIds.push(testProject.id);
  });

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    // Clean up in reverse dependency order (preserve testProject, testUser, and testBugReport for other tests)
    // 1. Delete bug reports first (except permanent ones created in beforeAll)
    for (const id of createdBugReportIds) {
      if (!permanentBugReportIds.has(id)) {
        try {
          await db.bugReports.delete(id);
        } catch {
          // Ignore if already deleted
        }
      }
    }

    // 2. Delete integrations
    for (const id of createdIntegrationIds) {
      try {
        await db.integrations.delete(id);
      } catch {
        // Ignore
      }
    }

    // 3. Delete projects (except testProject which is used across all tests)
    for (const id of createdProjectIds) {
      if (id !== testProject.id) {
        try {
          await db.projects.delete(id);
        } catch {
          // Ignore
        }
      }
    }

    // 4. Delete users (except testUser which is used across all tests)
    for (const id of createdUserIds) {
      if (id !== testUser.id) {
        try {
          await db.users.delete(id);
        } catch {
          // Ignore
        }
      }
    }

    // Reset tracking arrays (but keep testProject, testUser, and permanent bug reports for afterAll cleanup)
    createdBugReportIds = createdBugReportIds.filter((id) => permanentBugReportIds.has(id));
    createdIntegrationIds = [];
    createdProjectIds = createdProjectIds.filter((id) => id === testProject.id);
    createdUserIds = createdUserIds.filter((id) => id === testUser.id);
  });

  describe('IntegrationRepository', () => {
    describe('updateLastSync()', () => {
      it('should return 1 when updating existing integration', async () => {
        const integration = await db.integrations.create({
          type: `test_jira_${Date.now()}`,
          name: 'Test Jira',
          status: 'active',
        });
        createdIntegrationIds.push(integration.id);

        const rowCount = await db.integrations.updateLastSync(integration.id);

        expect(rowCount).toBe(1);

        // Verify last_sync_at was actually updated
        const updated = await db.integrations.findById(integration.id);
        expect(updated?.last_sync_at).not.toBeNull();
      });

      it('should return 0 when updating non-existent integration', async () => {
        const rowCount = await db.integrations.updateLastSync(
          '00000000-0000-0000-0000-000000000000'
        );

        expect(rowCount).toBe(0);
      });
    });

    describe('updateStatus()', () => {
      it('should return 1 when updating existing integration', async () => {
        const integration = await db.integrations.create({
          type: `test_linear_${Date.now()}`,
          name: 'Test Linear',
          status: 'not_configured',
        });
        createdIntegrationIds.push(integration.id);

        const rowCount = await db.integrations.updateStatus(integration.id, 'active');

        expect(rowCount).toBe(1);

        // Verify status was actually updated
        const updated = await db.integrations.findById(integration.id);
        expect(updated?.status).toBe('active');
      });

      it('should return 0 when updating non-existent integration', async () => {
        const rowCount = await db.integrations.updateStatus(
          '00000000-0000-0000-0000-000000000000',
          'error'
        );

        expect(rowCount).toBe(0);
      });
    });
  });

  describe('WebhookRepository', () => {
    describe('updateLastReceived()', () => {
      it('should return 1 when updating existing webhook', async () => {
        const webhook = await db.webhooks.create({
          integration_type: 'github',
          endpoint_url: `https://example.com/webhook/${Date.now()}`,
          secret: 'secret123',
        });

        const rowCount = await db.webhooks.updateLastReceived(webhook.id);

        expect(rowCount).toBe(1);

        // Verify last_received_at and failure_count were updated
        const updated = await db.webhooks.findById(webhook.id);
        expect(updated?.last_received_at).not.toBeNull();
        expect(updated?.failure_count).toBe(0);
      });

      it('should return 0 when updating non-existent webhook', async () => {
        const rowCount = await db.webhooks.updateLastReceived(
          '00000000-0000-0000-0000-000000000000'
        );

        expect(rowCount).toBe(0);
      });
    });

    describe('resetFailureCount()', () => {
      it('should return 1 when resetting existing webhook', async () => {
        const webhook = await db.webhooks.create({
          integration_type: 'gitlab',
          endpoint_url: `https://example.com/webhook/${Date.now()}`,
          secret: 'secret456',
        });

        // Set failure count by updating
        await db.webhooks.update(webhook.id, { failure_count: 5 });

        const rowCount = await db.webhooks.resetFailureCount(webhook.id);

        expect(rowCount).toBe(1);

        // Verify failure_count was reset
        const updated = await db.webhooks.findById(webhook.id);
        expect(updated?.failure_count).toBe(0);
      });

      it('should return 0 when resetting non-existent webhook', async () => {
        const rowCount = await db.webhooks.resetFailureCount(
          '00000000-0000-0000-0000-000000000000'
        );

        expect(rowCount).toBe(0);
      });
    });

    describe('disable()', () => {
      it('should return 1 when disabling existing webhook', async () => {
        const webhook = await db.webhooks.create({
          integration_type: 'bitbucket',
          endpoint_url: `https://example.com/webhook/${Date.now()}`,
          secret: 'secret789',
          active: true,
        });

        const rowCount = await db.webhooks.disable(webhook.id);

        expect(rowCount).toBe(1);

        // Verify webhook was disabled
        const updated = await db.webhooks.findById(webhook.id);
        expect(updated?.active).toBe(false);
      });

      it('should return 0 when disabling non-existent webhook', async () => {
        const rowCount = await db.webhooks.disable('00000000-0000-0000-0000-000000000000');

        expect(rowCount).toBe(0);
      });
    });

    describe('enable()', () => {
      it('should return 1 when enabling existing webhook', async () => {
        const webhook = await db.webhooks.create({
          integration_type: 'azure',
          endpoint_url: `https://example.com/webhook/${Date.now()}`,
          secret: 'secret000',
          active: false,
        });

        const rowCount = await db.webhooks.enable(webhook.id);

        expect(rowCount).toBe(1);

        // Verify webhook was enabled
        const updated = await db.webhooks.findById(webhook.id);
        expect(updated?.active).toBe(true);
      });

      it('should return 0 when enabling non-existent webhook', async () => {
        const rowCount = await db.webhooks.enable('00000000-0000-0000-0000-000000000000');

        expect(rowCount).toBe(0);
      });
    });
  });

  describe('ProjectMemberRepository', () => {
    describe('removeMember()', () => {
      it('should return 1 when removing existing member', async () => {
        const user = await db.users.create({
          email: `member-${Date.now()}@test.com`,
          password_hash: 'hash',
          role: 'user',
        });
        createdUserIds.push(user.id);

        await db.projectMembers.addMember(testProject.id, user.id, 'member');

        const rowCount = await db.projectMembers.removeMember(testProject.id, user.id);

        expect(rowCount).toBe(1);

        // Verify member was removed
        const members = await db.projectMembers.getProjectMembers(testProject.id);
        expect(members.find((m) => m.user_id === user.id)).toBeUndefined();
      });

      it('should return 0 when removing non-existent member', async () => {
        const rowCount = await db.projectMembers.removeMember(
          testProject.id,
          '00000000-0000-0000-0000-000000000000'
        );

        expect(rowCount).toBe(0);
      });

      it('should return 0 when removing member from non-existent project', async () => {
        const rowCount = await db.projectMembers.removeMember(
          '00000000-0000-0000-0000-000000000000',
          testUser.id
        );

        expect(rowCount).toBe(0);
      });
    });
  });

  describe('NotificationChannelRepository', () => {
    describe('updateHealth()', () => {
      it('should return 1 when updating health for existing channel (success)', async () => {
        const channel = await db.notificationChannels.create({
          project_id: testProject.id,
          name: 'Test Email Channel',
          type: 'email',
          config: {
            type: 'email',
            smtp_host: 'smtp.test.com',
            smtp_port: 587,
            smtp_secure: true,
            smtp_user: 'user',
            smtp_pass: 'pass',
            from_address: 'test@example.com',
            from_name: 'Test',
          },
        });

        const rowCount = await db.notificationChannels.updateHealth(channel.id, true);

        expect(rowCount).toBe(1);

        // Verify last_success_at was updated and failure_count reset
        const updated = await db.notificationChannels.findById(channel.id);
        expect(updated?.last_success_at).not.toBeNull();
        expect(updated?.failure_count).toBe(0);
      });

      it('should return 1 when updating health for existing channel (failure)', async () => {
        const channel = await db.notificationChannels.create({
          project_id: testProject.id,
          name: 'Test Slack Channel',
          type: 'slack',
          config: {
            type: 'slack',
            webhook_url: 'https://hooks.slack.com/test',
          },
        });

        const rowCount = await db.notificationChannels.updateHealth(channel.id, false);

        expect(rowCount).toBe(1);

        // Verify last_failure_at was updated and failure_count incremented
        const updated = await db.notificationChannels.findById(channel.id);
        expect(updated?.last_failure_at).not.toBeNull();
        expect(updated?.failure_count).toBe(1);
      });

      it('should return 0 when updating health for non-existent channel', async () => {
        const rowCount = await db.notificationChannels.updateHealth(
          '00000000-0000-0000-0000-000000000000',
          true
        );

        expect(rowCount).toBe(0);
      });
    });
  });

  describe('BugReportRepository', () => {
    let testBugReport: BugReport;

    beforeAll(async () => {
      testBugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug for Update Methods',
        description: 'Testing update methods',
      });
      // Track for cleanup in afterAll (skip in afterEach)
      createdBugReportIds.push(testBugReport.id);
      permanentBugReportIds.add(testBugReport.id);
    });

    describe('updateScreenshotUrls()', () => {
      it('should return 1 when updating existing bug report', async () => {
        const rowCount = await db.bugReports.updateScreenshotUrls(
          testBugReport.id,
          'https://s3.example.com/screenshot.png',
          'https://s3.example.com/thumbnail.png',
          'screenshots/test-project/test-bug/screenshot.png',
          'screenshots/test-project/test-bug/thumbnail.png'
        );

        expect(rowCount).toBe(1);

        // Verify URLs were updated
        const updated = await db.bugReports.findById(testBugReport.id);
        expect(updated?.screenshot_url).toBe('https://s3.example.com/screenshot.png');
        expect(updated?.metadata?.thumbnailUrl).toBe('https://s3.example.com/thumbnail.png');
      });

      it('should return 0 when updating non-existent bug report', async () => {
        const rowCount = await db.bugReports.updateScreenshotUrls(
          '00000000-0000-0000-0000-000000000000',
          'https://s3.example.com/screenshot.png',
          'https://s3.example.com/thumbnail.png',
          'screenshots/test-project/test-bug/screenshot.png',
          'screenshots/test-project/test-bug/thumbnail.png'
        );

        expect(rowCount).toBe(0);
      });
    });

    describe('updateReplayManifestUrl()', () => {
      it('should return 1 when updating existing bug report', async () => {
        const rowCount = await db.bugReports.updateReplayManifestUrl(
          testBugReport.id,
          'https://s3.example.com/replay/manifest.json'
        );

        expect(rowCount).toBe(1);

        // Verify manifest URL was updated
        const updated = await db.bugReports.findById(testBugReport.id);
        expect(updated?.metadata?.replayManifestUrl).toBe(
          'https://s3.example.com/replay/manifest.json'
        );
      });

      it('should return 0 when updating non-existent bug report', async () => {
        const rowCount = await db.bugReports.updateReplayManifestUrl(
          '00000000-0000-0000-0000-000000000000',
          'https://s3.example.com/replay/manifest.json'
        );

        expect(rowCount).toBe(0);
      });
    });

    describe('updateExternalIntegration()', () => {
      it('should return 1 when updating existing bug report', async () => {
        const rowCount = await db.bugReports.updateExternalIntegration(
          testBugReport.id,
          'JIRA-123',
          'https://jira.example.com/browse/JIRA-123'
        );

        expect(rowCount).toBe(1);

        // Verify external integration was updated
        const updated = await db.bugReports.findById(testBugReport.id);
        expect(updated?.metadata?.externalId).toBe('JIRA-123');
        expect(updated?.metadata?.externalUrl).toBe('https://jira.example.com/browse/JIRA-123');
      });

      it('should return 0 when updating non-existent bug report', async () => {
        const rowCount = await db.bugReports.updateExternalIntegration(
          '00000000-0000-0000-0000-000000000000',
          'JIRA-456',
          'https://jira.example.com/browse/JIRA-456'
        );

        expect(rowCount).toBe(0);
      });
    });

    describe('initiateUpload()', () => {
      it('should return 1 when initiating screenshot upload', async () => {
        const storageKey = 'screenshots/test-project/test-bug/screenshot.png';
        const rowCount = await db.bugReports.initiateUpload(
          testBugReport.id,
          storageKey,
          'screenshot_key',
          'upload_status'
        );

        expect(rowCount).toBe(1);

        // Verify storage key and status were updated
        const updated = await db.bugReports.findById(testBugReport.id);
        expect(updated?.screenshot_key).toBe(storageKey);
        expect(updated?.upload_status).toBe('pending');
      });

      it('should return 1 when initiating replay upload', async () => {
        const storageKey = 'replays/test-project/test-bug/replay.gz';
        const rowCount = await db.bugReports.initiateUpload(
          testBugReport.id,
          storageKey,
          'replay_key',
          'replay_upload_status'
        );

        expect(rowCount).toBe(1);

        // Verify storage key and status were updated
        const updated = await db.bugReports.findById(testBugReport.id);
        expect(updated?.replay_key).toBe(storageKey);
        expect(updated?.replay_upload_status).toBe('pending');
      });

      it('should return 0 when updating non-existent bug report', async () => {
        const rowCount = await db.bugReports.initiateUpload(
          '00000000-0000-0000-0000-000000000000',
          'screenshots/test/missing.png',
          'screenshot_key',
          'upload_status'
        );

        expect(rowCount).toBe(0);
      });

      it('should throw error for invalid key column', async () => {
        await expect(
          db.bugReports.initiateUpload(
            testBugReport.id,
            'screenshots/test.png',
            'invalid_column' as any,
            'upload_status'
          )
        ).rejects.toThrow('Invalid key column');
      });

      it('should throw error for invalid status column', async () => {
        await expect(
          db.bugReports.initiateUpload(
            testBugReport.id,
            'screenshots/test.png',
            'screenshot_key',
            'invalid_status' as any
          )
        ).rejects.toThrow('Invalid status column');
      });
    });
  });
});
