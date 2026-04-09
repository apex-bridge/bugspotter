/**
 * Notification Routes Tests
 * Tests for notification channels, rules, templates, and history
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

// Mock nodemailer to prevent actual SMTP connections in tests
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(() =>
        Promise.resolve({
          accepted: ['test@example.com'],
          messageId: 'test-message-id',
        })
      ),
    })),
  },
}));

// Helper to add delay between tests to avoid rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Notification Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testAccessToken: string;
  let testAdminToken: string;
  let testUserId: string;
  let testProjectId: string;
  let testOrganizationId: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();

    // Create test users once at the beginning
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);

    // Create regular user
    const userResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `test-user-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    const userData = userResponse.json().data;
    testAccessToken = userData.access_token;
    testUserId = userData.user.id;

    // Create organization for the test user (required for organization-scoped routes)
    const orgResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${testAccessToken}`,
      },
      payload: {
        name: `Test Organization ${timestamp}`,
        subdomain: `test-org-${timestamp}-${randomId}`,
      },
    });
    const orgData = orgResponse.json().data;
    testOrganizationId = orgData.id;

    // Create admin user
    const { token: adminToken } = await createAdminUser(server, db, 'test-admin');
    testAdminToken = adminToken;
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Add small delay between tests
    await delay(100);

    // Create a fresh test project for each test (within the existing organization)
    // Note: We create directly via DB to ensure organization_id is properly set,
    // since the API relies on tenant middleware which isn't active in tests
    const timestamp = Date.now();
    const project = await db.projects.create({
      name: `Test Project ${timestamp}`,
      settings: {},
      organization_id: testOrganizationId,
    });
    testProjectId = project.id;

    // Add test user as project owner (required for channel access)
    await db.projectMembers.addMember(testProjectId, testUserId, 'owner');
  });

  // ============================================================================
  // CHANNEL TESTS
  // ============================================================================

  describe('Notification Channels', () => {
    describe('POST /api/v1/notifications/channels', () => {
      it('should create an email channel', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Email Notifications',
            type: 'email',
            config: {
              smtp_host: 'smtp.example.com',
              smtp_port: 587,
              smtp_secure: false,
              smtp_user: 'user@example.com',
              smtp_pass: 'password',
              from_address: 'noreply@example.com',
              from_name: 'BugSpotter',
            },
            active: true,
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(json.data.name).toBe('Email Notifications');
        expect(json.data.type).toBe('email');
        expect(json.data.active).toBe(true);
        expect(json.data.project_id).toBe(testProjectId);
      });

      it('should create a slack channel', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Slack Alerts',
            type: 'slack',
            config: {
              webhook_url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX',
              channel: '#bugs',
              username: 'BugSpotter',
            },
            active: true,
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.data.type).toBe('slack');
      });

      it('should require authentication', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: {},
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should validate required fields', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            name: 'Test Channel',
            // Missing project_id, type, config
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /api/v1/notifications/channels', () => {
      beforeEach(async () => {
        // Create a test channel
        await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: { smtp_host: 'smtp.test.com' },
          },
        });
      });

      it('should list all channels', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(json.data.channels).toBeInstanceOf(Array);
        expect(json.data.pagination).toBeDefined();
      });

      it('should filter by project_id', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/notifications/channels?project_id=${testProjectId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.channels.every((c: any) => c.project_id === testProjectId)).toBe(true);
      });

      it('should filter by type', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/channels?type=email',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.channels.every((c: any) => c.type === 'email')).toBe(true);
      });

      it('should support pagination', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/channels?page=1&limit=10',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.pagination.page).toBe(1);
        expect(json.data.pagination.limit).toBe(10);
      });
    });

    describe('GET /api/v1/notifications/channels/:id', () => {
      let channelId: string;

      beforeEach(async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: { smtp_host: 'smtp.test.com' },
          },
        });
        channelId = response.json().data.id;
      });

      it('should get channel by id', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/notifications/channels/${channelId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.id).toBe(channelId);
        expect(json.data.name).toBe('Test Channel');
      });

      it('should return 404 for non-existent channel', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/channels/00000000-0000-0000-0000-000000000000',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(404);
      });
    });

    describe('PATCH /api/v1/notifications/channels/:id', () => {
      let channelId: string;

      beforeEach(async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: { smtp_host: 'smtp.test.com' },
          },
        });
        channelId = response.json().data.id;
      });

      it('should update channel name', async () => {
        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/notifications/channels/${channelId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            name: 'Updated Channel Name',
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.name).toBe('Updated Channel Name');
      });

      it('should update channel active status', async () => {
        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/notifications/channels/${channelId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            active: false,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.active).toBe(false);
      });
    });

    describe('DELETE /api/v1/notifications/channels/:id', () => {
      let channelId: string;

      beforeEach(async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: { smtp_host: 'smtp.test.com' },
          },
        });
        channelId = response.json().data.id;
      });

      it('should delete channel', async () => {
        const response = await server.inject({
          method: 'DELETE',
          url: `/api/v1/notifications/channels/${channelId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.message).toContain('deleted');
      });
    });

    describe('POST /api/v1/notifications/channels/:id/test', () => {
      let channelId: string;

      beforeEach(async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: { smtp_host: 'smtp.test.com' },
            active: true,
          },
        });
        channelId = response.json().data.id;
      });

      it('should test channel delivery', async () => {
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/notifications/channels/${channelId}/test`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            test_message: 'Test notification',
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.delivered).toBeDefined();
        expect(json.data.message).toBeDefined();
      });
    });
  });

  // ============================================================================
  // RULE TESTS
  // ============================================================================

  describe('Notification Rules', () => {
    let channelId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/notifications/channels',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          project_id: testProjectId,
          name: 'Test Channel',
          type: 'email',
          config: { smtp_host: 'smtp.test.com' },
        },
      });
      channelId = response.json().data.id;
    });

    describe('POST /api/v1/notifications/rules', () => {
      it('should create a notification rule', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Critical Bug Alert',
            enabled: true,
            triggers: [
              {
                event: 'new_bug',
                params: {
                  priority: 'critical',
                },
              },
            ],
            channel_ids: [channelId],
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(json.data.name).toBe('Critical Bug Alert');
        expect(json.data.enabled).toBe(true);
        expect(json.data.triggers).toHaveLength(1);
      });

      it('should create rule with filters', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Production Errors',
            triggers: [{ event: 'new_bug' }],
            filters: [
              {
                field: 'status',
                operator: 'in',
                value: ['open', 'in_progress'],
              },
            ],
            channel_ids: [channelId],
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.data.filters).toHaveLength(1);
      });

      it('should create rule with throttle config', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Throttled Rule',
            triggers: [{ event: 'new_bug' }],
            throttle: {
              max_per_hour: 10,
              max_per_day: 100,
              group_by: 'error_signature',
            },
            channel_ids: [channelId],
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.data.throttle).toBeDefined();
        expect(json.data.throttle.max_per_hour).toBe(10);
      });

      it('should require at least one channel', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Invalid Rule',
            triggers: [{ event: 'new_bug' }],
            channel_ids: [], // Empty array
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /api/v1/notifications/rules', () => {
      beforeEach(async () => {
        await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Rule',
            triggers: [{ event: 'new_bug' }],
            channel_ids: [channelId],
          },
        });
      });

      it('should list all rules', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.rules).toBeInstanceOf(Array);
        expect(json.data.pagination).toBeDefined();
      });

      it('should filter by enabled status', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/rules?enabled=true',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.rules.every((r: any) => r.enabled === true)).toBe(true);
      });
    });

    describe('PATCH /api/v1/notifications/rules/:id', () => {
      let ruleId: string;

      beforeEach(async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Rule',
            triggers: [{ event: 'new_bug' }],
            channel_ids: [channelId],
          },
        });
        ruleId = response.json().data.id;
      });

      it('should update rule enabled status', async () => {
        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/notifications/rules/${ruleId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            enabled: false,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.enabled).toBe(false);
      });

      it('should update rule name', async () => {
        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/notifications/rules/${ruleId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            name: 'Updated Rule Name',
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.name).toBe('Updated Rule Name');
      });
    });

    describe('DELETE /api/v1/notifications/rules/:id', () => {
      let ruleId: string;

      beforeEach(async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/rules',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Rule',
            triggers: [{ event: 'new_bug' }],
            channel_ids: [channelId],
          },
        });
        ruleId = response.json().data.id;
      });

      it('should delete rule', async () => {
        const response = await server.inject({
          method: 'DELETE',
          url: `/api/v1/notifications/rules/${ruleId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.message).toContain('deleted');
      });
    });
  });

  // ============================================================================
  // TEMPLATE TESTS (Admin Only)
  // ============================================================================

  describe('Notification Templates', () => {
    describe('POST /api/v1/notifications/templates', () => {
      it('should create template (admin only)', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/templates',
          headers: {
            authorization: `Bearer ${testAdminToken}`,
          },
          payload: {
            name: 'New Bug Email',
            channel_type: 'email',
            trigger_type: 'new_bug',
            subject: 'New Bug: {{bug.title}}',
            body: 'A new bug was reported: {{bug.message}}',
            variables: [
              {
                name: 'bug.title',
                description: 'Bug title',
                example: 'Cannot login',
              },
            ],
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.data.name).toBe('New Bug Email');
        expect(json.data.channel_type).toBe('email');
      });

      it('should reject non-admin users', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/templates',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            name: 'Template',
            channel_type: 'email',
            trigger_type: 'new_bug',
            body: 'Test',
          },
        });

        expect(response.statusCode).toBe(403);
      });
    });

    describe('GET /api/v1/notifications/templates', () => {
      it('should list templates (admin only)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/templates',
          headers: {
            authorization: `Bearer ${testAdminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.templates).toBeInstanceOf(Array);
      });

      it('should filter by channel type', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/notifications/templates?channel_type=email',
          headers: {
            authorization: `Bearer ${testAdminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('POST /api/v1/notifications/templates/preview', () => {
      it('should preview template rendering', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/templates/preview',
          headers: {
            authorization: `Bearer ${testAdminToken}`,
          },
          payload: {
            template_body: 'Hello {{user.name}}, bug {{bug.id}} was reported.',
            subject: 'Bug Report: {{bug.title}}',
            context: {
              user: {
                name: 'John Doe',
              },
              bug: {
                id: '12345',
                title: 'Login Error',
              },
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.rendered_body).toContain('Hello John Doe');
        expect(json.data.rendered_body).toContain('12345');
        expect(json.data.rendered_subject).toContain('Login Error');
      });
    });
  });

  // ============================================================================
  // HISTORY TESTS
  // ============================================================================

  describe('Notification History', () => {
    describe('GET /api/v1/organizations/:id/notifications/history', () => {
      it('should list notification history', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.history).toBeInstanceOf(Array);
        expect(json.data.pagination).toBeDefined();
      });

      it('should filter by status', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?status=sent`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should support date filtering', async () => {
        const createdAfter = new Date('2024-01-01').toISOString();
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?created_after=${createdAfter}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should filter by multiple criteria including date ranges', async () => {
        const createdAfter = new Date('2024-01-01').toISOString();
        const createdBefore = new Date('2025-12-31').toISOString();
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?status=sent&created_after=${createdAfter}&created_before=${createdBefore}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.history).toBeInstanceOf(Array);
      });

      it('should filter by channel_id', async () => {
        // Create a channel first
        const channelResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            project_id: testProjectId,
            name: 'Test Email Channel',
            type: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: { user: 'test@example.com', pass: 'password' },
              },
              from: 'test@example.com',
            },
            active: true,
          },
        });
        const channelId = channelResponse.json().data.id;

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?channel_id=${channelId}`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should handle pagination correctly', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?page=1&limit=10`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.pagination.page).toBe(1);
        expect(json.data.pagination.limit).toBe(10);
        expect(json.data.pagination.totalPages).toBeDefined();
      });
    });

    // ============================================================================
    // SECURITY TESTS - Information Disclosure Prevention
    // ============================================================================

    describe('GET /api/v1/organizations/:id/notifications/history - Security', () => {
      it("should prevent user from accessing another organization's history", async () => {
        // Create second user with their own organization/project
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(7);
        const user2Response = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `user2-${timestamp}@example.com`,
            password: 'password123',
          },
        });
        const user2Token = user2Response.json().data.access_token;

        // Create organization for user2
        const org2Response = await server.inject({
          method: 'POST',
          url: '/api/v1/organizations',
          headers: { authorization: `Bearer ${user2Token}` },
          payload: {
            name: `User 2 Organization ${timestamp}`,
            subdomain: `user2-org-${timestamp}-${randomId}`,
          },
        });
        const user2OrgId = org2Response.json().data.id;

        // User 1 tries to access User 2's organization history
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${user2OrgId}/notifications/history`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        // Should be denied - user is not a member of this organization
        expect(response.statusCode).toBe(403);
      });

      it("should prevent user from accessing another org's history via channel_id filter", async () => {
        // Create second user with their own organization and project
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(7);
        const user2Response = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `user2b-${timestamp}@example.com`,
            password: 'password123',
          },
        });
        const user2Data = user2Response.json().data;
        const user2Token = user2Data.access_token;
        const user2Id = user2Data.user.id;

        // Create organization for user2
        const org2Response = await server.inject({
          method: 'POST',
          url: '/api/v1/organizations',
          headers: { authorization: `Bearer ${user2Token}` },
          payload: {
            name: `User 2b Organization ${timestamp}`,
            subdomain: `user2b-org-${timestamp}-${randomId}`,
          },
        });
        const user2OrgId = org2Response.json().data.id;

        // Create project for user2 in their organization
        const project2 = await db.projects.create({
          name: `Project 2b ${timestamp}`,
          settings: {},
          organization_id: user2OrgId,
        });
        const project2Id = project2.id;

        // Add user2 as project owner
        await db.projectMembers.addMember(project2Id, user2Id, 'owner');

        // User 2 creates a channel in their project
        const channelResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: { authorization: `Bearer ${user2Token}` },
          payload: {
            project_id: project2Id,
            name: 'User 2 Email Channel',
            type: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: { user: 'user2@example.com', pass: 'password' },
              },
              from: 'user2@example.com',
            },
            active: true,
          },
        });
        const user2ChannelId = channelResponse.json().data.id;

        // User 1 tries to access User 2's channel history via their own org (should fail)
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?channel_id=${user2ChannelId}`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        // Channel doesn't belong to user1's organization
        expect(response.statusCode).toBe(403);
      });

      it('should allow user to access their own organization history', async () => {
        // Create a channel in user's own project
        const channelResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: { authorization: `Bearer ${testAccessToken}` },
          payload: {
            project_id: testProjectId,
            name: 'My Email Channel',
            type: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: { user: 'test@example.com', pass: 'password' },
              },
              from: 'test@example.com',
            },
            active: true,
          },
        });
        const channelId = channelResponse.json().data.id;

        // User accesses their own organization's history
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history?channel_id=${channelId}`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data.history).toBeInstanceOf(Array);
      });

      it('should return results when listing history for own organization', async () => {
        // User lists their organization's history
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.history).toBeInstanceOf(Array);
        expect(json.data.pagination).toBeDefined();
      });
    });

    describe('GET /api/v1/organizations/:id/notifications/history/:historyId - Security', () => {
      it("should prevent user from accessing another organization's history entry", async () => {
        // Create second user with their own organization and project
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(7);
        const user2Response = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `user5-${timestamp}@example.com`,
            password: 'password123',
          },
        });
        const user2Data = user2Response.json().data;
        const user2Token = user2Data.access_token;
        const user2Id = user2Data.user.id;

        // Create organization for user2
        const org2Response = await server.inject({
          method: 'POST',
          url: '/api/v1/organizations',
          headers: { authorization: `Bearer ${user2Token}` },
          payload: {
            name: `User 5 Organization ${timestamp}`,
            subdomain: `user5-org-${timestamp}-${randomId}`,
          },
        });
        const user2OrganizationId = org2Response.json().data.id;

        // Create project for user2 in their organization
        const project2 = await db.projects.create({
          name: `Project 5 ${timestamp}`,
          settings: {},
          organization_id: user2OrganizationId,
        });
        const project2Id = project2.id;

        // Add user2 as project owner
        await db.projectMembers.addMember(project2Id, user2Id, 'owner');

        // User 2 creates channel and potentially a history entry
        const channelResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: { authorization: `Bearer ${user2Token}` },
          payload: {
            project_id: project2Id,
            name: 'User 2 Channel',
            type: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: { user: 'user2@example.com', pass: 'password' },
              },
              from: 'user2@example.com',
            },
            active: true,
          },
        });
        const user2ChannelId = channelResponse.json().data.id;

        // Create a history entry for user 2
        const historyEntry = await db.notificationHistory.create({
          channel_id: user2ChannelId,
          recipients: ['recipient@example.com'],
          payload: {},
          status: 'pending',
        } as any);

        // User 1 tries to access User 2's organization's history entry
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${user2OrganizationId}/notifications/history/${historyEntry.id}`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        // Should be forbidden - user 1 is not a member of user 2's organization
        expect(response.statusCode).toBe(403);
      });

      it('should allow organization member to access their own organization history entry', async () => {
        // Create channel in user's own project
        const channelResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: { authorization: `Bearer ${testAccessToken}` },
          payload: {
            project_id: testProjectId,
            name: 'My Channel',
            type: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: { user: 'test@example.com', pass: 'password' },
              },
              from: 'test@example.com',
            },
            active: true,
          },
        });
        const channelId = channelResponse.json().data.id;

        // Create a history entry
        const historyEntry = await db.notificationHistory.create({
          channel_id: channelId,
          recipients: ['recipient@example.com'],
          payload: {},
          status: 'pending',
        } as any);

        // User accesses their own organization's history entry
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history/${historyEntry.id}`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data.id).toBe(historyEntry.id);
      });

      it('should allow organization owner to access organization history entry', async () => {
        // Create channel in organization owner's project
        const channelResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/notifications/channels',
          headers: { authorization: `Bearer ${testAccessToken}` },
          payload: {
            project_id: testProjectId,
            name: 'Test Channel',
            type: 'email',
            config: {
              smtp: {
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: { user: 'test@example.com', pass: 'password' },
              },
              from: 'test@example.com',
            },
            active: true,
          },
        });
        const channelId = channelResponse.json().data.id;

        // Create a history entry
        const historyEntry = await db.notificationHistory.create({
          channel_id: channelId,
          recipients: ['recipient@example.com'],
          payload: {},
          status: 'pending',
        } as any);

        // Organization owner accesses their organization's history entry
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${testOrganizationId}/notifications/history/${historyEntry.id}`,
          headers: { authorization: `Bearer ${testAccessToken}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data.id).toBe(historyEntry.id);
      });
    });
  });
});
