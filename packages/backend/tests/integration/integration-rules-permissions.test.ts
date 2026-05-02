/**
 * Integration Rules Permissions E2E Tests
 *
 * Tests complete permission flow for integration rules API:
 * - Regular users with project membership can CRUD integration rules
 * - Viewers can only read
 * - Non-members cannot access
 * - Admin bypass works regardless of project membership
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServerWithDb } from '../setup.integration.js';
import { createTestUser, createTestProject, TestCleanupTracker } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { User, Project } from '../../src/db/types.js';
import { getEncryptionService } from '../../src/utils/encryption.js';

describe('Integration Rules Permissions - E2E', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();
  let testProject: Project;
  let adminUser: User;
  let regularUser: User;
  let viewerUser: User;
  let outsiderUser: User;
  let adminJwt: string;
  let regularUserJwt: string;
  let viewerUserJwt: string;
  let outsiderJwt: string;
  let ruleId: string;
  let jiraIntegrationGlobalId: string;

  const encryptionService = getEncryptionService();

  beforeAll(async () => {
    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;

    // Use existing Jira integration from migration
    const globalIntegration = await db.integrations.findByType('jira');
    if (!globalIntegration) {
      throw new Error('Jira integration not found in database - migration may have failed');
    }
    jiraIntegrationGlobalId = globalIntegration.id;

    // Create admin user
    const adminData = await createTestUser(db, { role: 'admin' });
    adminUser = adminData.user;
    cleanup.trackUser(adminUser.id);

    // Create regular user
    const regularData = await createTestUser(db, { role: 'user' });
    regularUser = regularData.user;
    cleanup.trackUser(regularUser.id);

    // Create viewer user
    const viewerData = await createTestUser(db, { role: 'viewer' });
    viewerUser = viewerData.user;
    cleanup.trackUser(viewerUser.id);

    // Create outsider user (not a member)
    const outsiderData = await createTestUser(db, { role: 'user' });
    outsiderUser = outsiderData.user;
    cleanup.trackUser(outsiderUser.id);

    // Create test project
    testProject = await createTestProject(db, { created_by: adminUser.id });
    cleanup.trackProject(testProject.id);

    // Add regular user as project admin. The integration-rules CRUD routes
    // (create / update / delete / copy) now require `requireProjectRole('admin')`
    // — see src/api/routes/integration-rules.ts:203,269,313,360 — so a `member`
    // role no longer suffices to exercise the "should allow regular user to ..."
    // tests below. The PLATFORM role stays `user` (set in createTestUser),
    // so these tests still verify that a non-platform-admin can perform the
    // op when their project role is sufficient.
    await db.projectMembers.addMember(testProject.id, regularUser.id, 'admin');

    // Add viewer user as member
    await db.projectMembers.addMember(testProject.id, viewerUser.id, 'viewer');

    // Login all users
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: adminData.user.email, password: adminData.password },
    });
    adminJwt = JSON.parse(adminLogin.body).data.access_token;

    const regularLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: regularData.user.email, password: regularData.password },
    });
    regularUserJwt = JSON.parse(regularLogin.body).data.access_token;

    const viewerLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: viewerData.user.email, password: viewerData.password },
    });
    viewerUserJwt = JSON.parse(viewerLogin.body).data.access_token;

    const outsiderLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: outsiderData.user.email, password: outsiderData.password },
    });
    outsiderJwt = JSON.parse(outsiderLogin.body).data.access_token;

    // Create a Jira integration for the project
    const encryptedCredentials = encryptionService.encrypt(
      JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
    );

    await db.projectIntegrations.create({
      project_id: testProject.id,
      integration_id: jiraIntegrationGlobalId,
      config: {
        instanceUrl: 'https://example.atlassian.net',
        projectKey: 'TEST',
        issueType: 'Bug',
        autoCreate: true,
        syncStatus: false,
        syncComments: false,
      },
      encrypted_credentials: encryptedCredentials,
      enabled: true,
    });

    // Create an integration rule as admin
    const ruleResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/integrations/jira/${testProject.id}/rules`,
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        name: 'High Severity Auto-Create',
        enabled: true,
        priority: 1,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'high',
          },
        ],
        auto_create: true,
        throttle: null,
        field_mappings: null,
        description_template: null,
        attachment_config: null,
      },
    });
    ruleId = JSON.parse(ruleResponse.body).data.id;
  });

  beforeEach(async () => {
    // Reset rule to known state before each test
    await db.query('UPDATE integration_rules SET enabled = true WHERE id = $1', [ruleId]);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    await server.close();
    await db.close();
  });

  describe('READ - List Rules (GET /api/v1/integrations/:platform/:projectId/rules)', () => {
    it('should allow regular user to list rules for their project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${regularUserJwt}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body).data;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(ruleId);
    });

    it('should allow viewer to list rules for their project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${viewerUserJwt}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body).data;
      expect(data).toHaveLength(1);
    });

    it('should deny outsider from listing rules', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${outsiderJwt}` },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain('Access denied');
    });
  });

  describe('CREATE - Create Rule (POST /api/v1/integrations/:platform/:projectId/rules)', () => {
    it('should allow regular user to create rules for their project', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${regularUserJwt}` },
        payload: {
          name: 'User Created Rule',
          enabled: true,
          priority: 2,
          filters: [
            {
              field: 'status',
              operator: 'equals',
              value: 'error',
            },
          ],
          auto_create: false,
          throttle: null,
          field_mappings: null,
          description_template: 'Bug created by user: {{user_email}}',
          attachment_config: null,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body).data;
      expect(data.name).toBe('User Created Rule');

      // Clean up
      await db.query('DELETE FROM integration_rules WHERE id = $1', [data.id]);
    });

    it('should deny viewer from creating rules', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${viewerUserJwt}` },
        payload: {
          name: 'Viewer Rule',
          enabled: true,
          filters: [
            {
              field: 'priority',
              operator: 'equals',
              value: 'critical',
            },
          ],
          auto_create: false,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain(
        'Insufficient permissions to create integration_rules'
      );
    });

    it('should deny outsider from creating rules', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${outsiderJwt}` },
        payload: {
          name: 'Outsider Rule',
          enabled: true,
          filters: [
            {
              field: 'browser',
              operator: 'contains',
              value: 'chrome',
            },
          ],
          auto_create: false,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain('Access denied');
    });
  });

  describe('UPDATE - Update Rule (PATCH /api/v1/integrations/:platform/:projectId/rules/:ruleId)', () => {
    it('should allow regular user to update rules for their project', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${regularUserJwt}` },
        payload: {
          name: 'Updated by Regular User',
          enabled: false,
          priority: 5,
          filters: [
            {
              field: 'error_message',
              operator: 'contains',
              value: 'critical',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body).data;
      expect(data.name).toBe('Updated by Regular User');
      expect(data.enabled).toBe(false);
      expect(data.priority).toBe(5);

      // Verify update persisted
      const updated = await db.query(
        'SELECT name, enabled, priority FROM integration_rules WHERE id = $1',
        [ruleId]
      );
      expect(updated.rows[0].name).toBe('Updated by Regular User');
      expect(updated.rows[0].enabled).toBe(false);
      expect(updated.rows[0].priority).toBe(5);
    });

    it('should deny viewer from updating rules', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${viewerUserJwt}` },
        payload: {
          name: 'Viewer Update Attempt',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain(
        'Insufficient permissions to update integration_rules'
      );
    });

    it('should deny outsider from updating rules', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${outsiderJwt}` },
        payload: {
          name: 'Outsider Update Attempt',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain('Access denied');
    });
  });

  describe('DELETE - Delete Rule (DELETE /api/v1/integrations/:platform/:projectId/rules/:ruleId)', () => {
    it('should allow regular user to delete rules for their project', async () => {
      // Create a rule to delete
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${adminJwt}` },
        payload: {
          name: 'Rule to Delete',
          enabled: true,
          filters: [
            {
              field: 'os',
              operator: 'equals',
              value: 'windows',
            },
          ],
          auto_create: false,
        },
      });
      const deleteRuleId = JSON.parse(createResponse.body).data.id;

      // Delete as regular user
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${deleteRuleId}`,
        headers: { authorization: `Bearer ${regularUserJwt}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toContain('deleted successfully');

      // Verify deletion
      const deleted = await db.query('SELECT id FROM integration_rules WHERE id = $1', [
        deleteRuleId,
      ]);
      expect(deleted.rows).toHaveLength(0);
    });

    it('should deny viewer from deleting rules', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${viewerUserJwt}` },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain(
        'Insufficient permissions to delete integration_rules'
      );
    });

    it('should deny outsider from deleting rules', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${outsiderJwt}` },
      });

      // Outsider has platform role `user`, which doesn't carry
      // `integration_rules:delete` in the permissions table. They're denied
      // by `requirePermission` BEFORE `requireProjectAccess` runs — same
      // 403 path as the viewer test above. The previous "Access denied"
      // assertion expected a `requireProjectAccess` rejection, but middleware
      // ordering means that path is unreachable for any platform role
      // lacking the system permission. Either denial is correct; pin to
      // the current actual message.
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain(
        'Insufficient permissions to delete integration_rules'
      );
    });
  });

  describe('COPY - Copy Rule (POST /api/v1/integrations/:platform/:projectId/rules/:ruleId/copy)', () => {
    it('should allow regular user to copy rules to target project with access', async () => {
      // Create a second project where regular user is a project admin —
      // copy requires admin on BOTH source and target project (see route
      // preHandler in src/api/routes/integration-rules.ts:360).
      const secondProject = await createTestProject(db, { created_by: adminUser.id });
      cleanup.trackProject(secondProject.id);
      await db.projectMembers.addMember(secondProject.id, regularUser.id, 'admin');

      // Create integration for second project
      const encryptedCredentials = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );
      await db.projectIntegrations.create({
        project_id: secondProject.id,
        integration_id: jiraIntegrationGlobalId,
        config: {
          instanceUrl: 'https://example.atlassian.net',
          projectKey: 'TEST2',
          issueType: 'Bug',
          autoCreate: false,
          syncStatus: false,
          syncComments: false,
        },
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}/copy`,
        headers: { authorization: `Bearer ${regularUserJwt}` },
        payload: {
          targetProjectId: secondProject.id,
        },
      });

      expect(response.statusCode).toBe(201);
      const responseBody = JSON.parse(response.body);

      // Check that response has the expected structure
      expect(responseBody.success).toBe(true);
      expect(responseBody.data).toBeDefined();
      expect(responseBody.data.rule).toBeDefined();

      // Verify copied rule properties
      const copiedRule = responseBody.data.rule;
      expect(copiedRule.id).toBeDefined();
      expect(copiedRule.project_id).toBe(secondProject.id);
      expect(copiedRule.name).toBe('Updated by Regular User (Copy)');

      // Clean up
      await db.query('DELETE FROM integration_rules WHERE id = $1', [responseBody.data.rule.id]);
    });

    it('should deny viewer from copying rules (requires create permission)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}/copy`,
        headers: { authorization: `Bearer ${viewerUserJwt}` },
        payload: {
          targetProjectId: testProject.id,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain(
        'Insufficient permissions to create integration_rules'
      );
    });

    it('should deny outsider from copying rules', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}/copy`,
        headers: { authorization: `Bearer ${outsiderJwt}` },
        payload: {
          targetProjectId: testProject.id,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain('Access denied');
    });
  });

  describe('Admin Bypass', () => {
    it('should allow admin to perform all operations regardless of project membership', async () => {
      // Admin is project owner, but test they can access any project

      // Read
      const readResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${adminJwt}` },
      });
      expect(readResponse.statusCode).toBe(200);

      // Update
      const updateResponse = await server.inject({
        method: 'PATCH',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${adminJwt}` },
        payload: {
          name: 'Admin Updated',
          description_template: 'Admin can update any rule',
        },
      });
      expect(updateResponse.statusCode).toBe(200);
      expect(JSON.parse(updateResponse.body).data.name).toBe('Admin Updated');

      // Create (additional admin test)
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${adminJwt}` },
        payload: {
          name: 'Admin Created Rule',
          enabled: true,
          priority: 10,
          filters: [
            {
              field: 'user_email',
              operator: 'contains',
              value: '@admin.com',
            },
          ],
          auto_create: true,
          throttle: {
            max_per_hour: 10,
            group_by: 'user',
          },
        },
      });
      expect(createResponse.statusCode).toBe(201);

      // Clean up admin-created rule
      const adminRuleId = JSON.parse(createResponse.body).data.id;
      await db.query('DELETE FROM integration_rules WHERE id = $1', [adminRuleId]);
    });
  });
});
