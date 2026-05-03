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

    // Add regular user as project admin. The create / update routes use
    // `requireProjectRole('admin')` (integration-rules.ts:203, 269), so
    // `member` would 403. The COPY route enforces admin on the TARGET
    // project only (inline `checkProjectAccess` in the handler at
    // integration-rules.ts:370-380); its preHandler (line 361) uses
    // `requireProjectAccess` with no minProjectRole, so the SOURCE
    // project just needs membership. We grant admin on the source anyway
    // for symmetry. Platform role stays `user`, so these tests still
    // verify that a non-platform-admin can do these ops when their
    // project role is sufficient. DELETE is excluded — see the rename
    // in the DELETE describe-block (platform `user` lacks
    // `integration_rules:delete` in the permissions seed).
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

  /**
   * Helper: create a fresh user with the given project role and return
   * their JWT. Used by the member-deny tests below to exercise the
   * `requireProjectRole('admin')` gate independently of the platform
   * permission check. Tracks the user for cleanup. Asserts the login
   * succeeded so a future auth-setup drift surfaces as a clear
   * "expected 200, got X" instead of a JSON parse error on undefined.
   */
  async function loginAsProjectRole(
    projectId: string,
    role: 'viewer' | 'member' | 'admin' | 'owner'
  ) {
    const userData = await createTestUser(db, { role: 'user' });
    cleanup.trackUser(userData.user.id);
    await db.projectMembers.addMember(projectId, userData.user.id, role);
    const loginResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userData.user.email, password: userData.password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const jwt = JSON.parse(loginResponse.body).data.access_token;
    return { user: userData.user, jwt };
  }

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

    // Coverage: a project `member` (not `admin`) is denied at the
    // `requireProjectRole('admin')` gate, NOT at requirePermission.
    // Without this test, a regression that relaxes the project-role
    // requirement back to 'member' (or removes the guard entirely)
    // would only be caught for the platform-permission gate via the
    // viewer/outsider tests above. Distinguished by the error message.
    it('should deny project member (with create permission) from creating rules', async () => {
      const { jwt: memberJwt } = await loginAsProjectRole(testProject.id, 'member');

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${memberJwt}` },
        payload: {
          name: 'Member Rule (should be denied)',
          enabled: true,
          filters: [{ field: 'os', operator: 'equals', value: 'linux' }],
          auto_create: false,
        },
      });

      expect(response.statusCode).toBe(403);
      // Platform `user` HAS `integration_rules:create`, so requirePermission
      // passes — the denial comes from `requireProjectRole('admin')`.
      expect(JSON.parse(response.body).message).toContain('Insufficient project permissions');
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

    // Locks in the project-role gate on PATCH (integration-rules.ts:269).
    // Without this, the gate could be relaxed back to `member` and only
    // viewer/outsider tests would still pass — both stop at the
    // platform-permission check before reaching `requireProjectRole`.
    it('should deny project member (with update permission) from updating rules', async () => {
      const { jwt: memberJwt } = await loginAsProjectRole(testProject.id, 'member');

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${memberJwt}` },
        payload: { name: 'Member Update (should be denied)' },
      });

      expect(response.statusCode).toBe(403);
      // Platform `user` HAS `integration_rules:update`, so requirePermission
      // passes — denial comes from `requireProjectRole('admin')`.
      expect(JSON.parse(response.body).message).toContain('Insufficient project permissions');
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
    // The permissions seed (db/migrations/001_initial_schema.sql) gives
    // platform role `user` create/read/update on integration_rules but
    // explicitly NOT delete — delete is admin-only at the system level.
    // So this case can only verify the platform-admin path; project-admin
    // alone is insufficient. Renamed accordingly.
    it('should allow platform admin to delete rules for their project', async () => {
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

      // Delete as platform admin (only role with `integration_rules:delete`).
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${deleteRuleId}`,
        headers: { authorization: `Bearer ${adminJwt}` },
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

    // Verifies the platform-permission gate is the binding constraint:
    // a project admin (platform `user` role) is denied because the
    // permissions seed grants `user` only create/read/update on
    // integration_rules — not :delete (migrations/001:565-572). This
    // pins the platform/project boundary so a future relaxation of
    // the platform gate can't slip through covered only by the viewer
    // case (which fails for an unrelated reason — viewer also lacks
    // :read on integration_rules at the platform level... actually,
    // viewer DOES have :read but not anything else; the failure path
    // is the same `requirePermission` gate).
    it('should deny project admin (platform user) from deleting rules', async () => {
      const { jwt: projectAdminJwt } = await loginAsProjectRole(testProject.id, 'admin');

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}`,
        headers: { authorization: `Bearer ${projectAdminJwt}` },
      });

      expect(response.statusCode).toBe(403);
      // Platform `user` lacks `integration_rules:delete`, so requirePermission
      // denies BEFORE requireProjectAccess/requireProjectRole runs — same
      // path as the viewer/outsider deny tests above. Project-admin role
      // doesn't compensate for the missing platform permission.
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

    // Verifies the platform-admin bypass on `requireProjectRole('admin')`.
    // claude flagged on PR-94 that under the current permissions seed the
    // `requireProjectRole('admin')` guard at integration-rules.ts:313 is
    // never the binding constraint on DELETE — only platform admins reach
    // it (everyone else is stopped earlier by `requirePermission`), and
    // platform admins bypass it via `isPlatformAdmin()` in `checkProjectAccess`
    // and `requireProjectRole`. If a future migration grants `:delete` to a
    // non-platform-admin role, the project-role gate suddenly becomes
    // load-bearing without warning. This positive test pins the bypass:
    // a platform admin who is NOT a project admin (or member) can still
    // delete, proving the bypass is wired correctly.
    it('should allow platform admin (not a project member) to delete rules', async () => {
      // Create a rule to delete — a fresh one so we don't churn the
      // shared `ruleId` used by other tests in the suite.
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules`,
        headers: { authorization: `Bearer ${adminJwt}` },
        payload: {
          name: 'Rule for platform-admin-bypass test',
          enabled: true,
          filters: [{ field: 'priority', operator: 'equals', value: 'low' }],
          auto_create: false,
        },
      });
      const targetRuleId = JSON.parse(createResponse.body).data.id;

      // Fresh platform admin, intentionally not added to the project.
      // Both `checkProjectAccess` and `requireProjectRole('admin')` short-
      // circuit on `isPlatformAdmin` BEFORE checking project membership,
      // so this user reaches the handler body without belonging to the
      // project at all.
      const platformAdminData = await createTestUser(db, { role: 'admin' });
      cleanup.trackUser(platformAdminData.user.id);
      const platformAdminLogin = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: platformAdminData.user.email,
          password: platformAdminData.password,
        },
      });
      expect(platformAdminLogin.statusCode).toBe(200);
      const platformAdminJwt = JSON.parse(platformAdminLogin.body).data.access_token;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${targetRuleId}`,
        headers: { authorization: `Bearer ${platformAdminJwt}` },
      });

      expect(response.statusCode).toBe(200);
      // Verify the row is actually gone, not just that the route returned
      // 200 — would catch a future regression where the route swallows
      // the error and reports success without persisting the delete.
      const deleted = await db.query('SELECT id FROM integration_rules WHERE id = $1', [
        targetRuleId,
      ]);
      expect(deleted.rows).toHaveLength(0);
    });
  });

  describe('COPY - Copy Rule (POST /api/v1/integrations/:platform/:projectId/rules/:ruleId/copy)', () => {
    it('should allow regular user to copy rules to target project with access', async () => {
      // Reset the source rule name so this test isn't order-dependent on
      // the UPDATE describe-block above mutating the shared `ruleId`.
      // Use the repo layer rather than raw SQL so a future migration
      // renaming the `name` column surfaces as a typecheck/test error
      // instead of a cryptic Postgres relation/column error at runtime.
      await db.integrationRules.update(ruleId, { name: 'High Severity Auto-Create' });

      // Create a second project where regular user is a project admin.
      // The copy route enforces `minProjectRole: 'admin'` on the TARGET
      // project only — inline `checkProjectAccess` in the handler body
      // (integration-rules.ts:370-380). The SOURCE project preHandler
      // is `requireProjectAccess` with no minProjectRole, so any
      // membership level (viewer/member/admin) on the source passes.
      // We give regularUser admin on both anyway because the role bump
      // for source happens in beforeAll for the create/update cases.
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
      expect(copiedRule.name).toBe('High Severity Auto-Create (Copy)');

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

    // Locks in the inline target-project admin gate
    // (`checkProjectAccess(targetProjectId, …, { minProjectRole: 'admin' })`
    // at integration-rules.ts:370-380). The viewer/outsider deny tests above
    // both fail BEFORE the handler body runs, so this is the only path that
    // exercises the inline target check. If `minProjectRole: 'admin'` were
    // dropped or relaxed, every other deny test still passes.
    it('should deny user with non-admin role on target project', async () => {
      // Source: regularUser is admin (set in beforeAll). Target: a fresh
      // project where the same user is only a `member`. Source-side gates
      // all pass (platform :create, source membership); failure is at the
      // inline target check.
      const targetProject = await createTestProject(db, { created_by: adminUser.id });
      cleanup.trackProject(targetProject.id);
      await db.projectMembers.addMember(targetProject.id, regularUser.id, 'member');
      await db.projectIntegrations.create({
        project_id: targetProject.id,
        integration_id: jiraIntegrationGlobalId,
        config: {
          instanceUrl: 'https://example.atlassian.net',
          projectKey: 'TGT',
          issueType: 'Bug',
          autoCreate: false,
          syncStatus: false,
          syncComments: false,
        },
        encrypted_credentials: encryptionService.encrypt(
          JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
        ),
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProject.id}/rules/${ruleId}/copy`,
        headers: { authorization: `Bearer ${regularUserJwt}` },
        payload: { targetProjectId: targetProject.id },
      });

      expect(response.statusCode).toBe(403);
      // Inline `checkProjectAccess` throws via `Insufficient project role for X`
      // when the resource name isn't 'Project'; here the route uses the
      // resource name 'Integration Rules'.
      expect(JSON.parse(response.body).message).toContain('Insufficient project role');
    });

    // FOLLOW-UP / DEFERRED: cross-tenant data exfiltration via copy.
    // Tracked in: https://github.com/apex-bridge/bugspotter/issues/96
    //
    // The copy preHandler is `requireProjectAccess` with no minProjectRole
    // (integration-rules.ts:361), so a user with only `viewer` membership
    // on the source project can extract that project's rule configurations
    // (filters / field_mappings / description_template / attachment_config)
    // by copying them into a project they admin. Fix is a one-line route
    // change (add `requireProjectRole('member')` to the copy source
    // preHandler) — see issue #96 for full repro and the acceptance test
    // shape. Belongs to the queued RBAC tightening PR rather than this
    // test cleanup. Intentionally NOT pinning a passing 201 lock-in test
    // here, because doing so would tell CI to permanently accept the
    // bypass and a future tightening would be blocked rather than
    // welcomed.
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
