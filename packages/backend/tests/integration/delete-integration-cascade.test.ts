import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from '../setup.integration';
import { createTestProject, createTestUser } from '../utils/test-utils';
import type { DatabaseClient } from '../../src/db/client';

describe('Integration Deletion Cascade', () => {
  let db: DatabaseClient;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const { user } = await createTestUser(db);
    userId = user.id;

    const project = await createTestProject(db, { name: 'Test Project', created_by: userId });
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should delete all project integrations and rules when global integration is deleted', async () => {
    // 1. Create a global integration (using Jira as example)
    const integration = await db.integrations.create({
      type: 'jira_test_delete',
      name: 'Test Jira Integration',
      status: 'active',
      is_custom: false,
      plugin_source: 'builtin',
      trust_level: 'builtin',
    });

    // 2. Create project-specific integration
    const projectIntegration = await db.projectIntegrations.create({
      project_id: projectId,
      integration_id: integration.id,
      enabled: true,
      config: { projectKey: 'TEST' },
    });

    // 3. Create an integration rule
    const rule = await db.integrationRules.create({
      project_id: projectId,
      integration_id: projectIntegration.id,
      name: 'High Priority Bugs',
      enabled: true,
      priority: 100,
      filters: [
        {
          field: 'priority',
          operator: 'equals',
          value: 'high',
        },
      ],
    });

    // 4. Create OAuth token for this integration
    const oauthToken = await db.oauthTokens.create({
      integration_type: integration.type,
      access_token: 'test_access_token_123',
      refresh_token: 'test_refresh_token_456',
      expires_at: new Date(Date.now() + 3600000), // 1 hour from now
      scope: 'read write',
    });

    // 5. Create field mappings for this integration
    const fieldMapping1 = await db.fieldMappings.create({
      integration_type: integration.type,
      source_field: 'title',
      target_field: 'summary',
      transform_type: 'direct',
      required: true,
    });

    const fieldMapping2 = await db.fieldMappings.create({
      integration_type: integration.type,
      source_field: 'description',
      target_field: 'description',
      transform_type: 'template',
      transform_config: { template: 'Bug: {{description}}' },
      required: false,
    });

    // Verify everything exists
    expect(integration).toBeDefined();
    expect(projectIntegration).toBeDefined();
    expect(rule).toBeDefined();
    expect(oauthToken).toBeDefined();
    expect(fieldMapping1).toBeDefined();
    expect(fieldMapping2).toBeDefined();

    const projectIntegrationBefore = await db.projectIntegrations.findByProjectAndPlatform(
      projectId,
      integration.type
    );
    expect(projectIntegrationBefore).toBeDefined();

    const ruleBefore = await db.integrationRules.findById(rule.id);
    expect(ruleBefore).toBeDefined();

    const oauthTokenBefore = await db.oauthTokens.findByIntegrationType(integration.type);
    expect(oauthTokenBefore).toBeDefined();

    const fieldMappingsBefore = await db.fieldMappings.getByIntegrationType(integration.type);
    expect(fieldMappingsBefore).toHaveLength(2);

    // 6. Delete the global integration (wrapped in transaction for atomicity)
    const result = await db.transaction(async (tx) => {
      // Delete all related entities in the correct order
      const deletedProjectIntegrations = await tx.projectIntegrations.deleteByPlatform(
        integration.type
      );
      await tx.oauthTokens.deleteByIntegrationType(integration.type);
      await tx.fieldMappings.deleteByIntegrationType(integration.type);
      await tx.integrations.delete(integration.id);

      return { deletedProjectIntegrations };
    });

    // 7. Verify cascade deletion of all entities
    expect(result.deletedProjectIntegrations).toBe(1);

    // Project integration should be deleted
    const projectIntegrationAfter = await db.projectIntegrations.findByProjectAndPlatform(
      projectId,
      integration.type
    );
    expect(projectIntegrationAfter).toBeNull();

    // Integration rule should be cascade deleted by database
    const ruleAfter = await db.integrationRules.findById(rule.id);
    expect(ruleAfter).toBeNull();

    // OAuth token should be deleted
    const oauthTokenAfter = await db.oauthTokens.findByIntegrationType(integration.type);
    expect(oauthTokenAfter).toBeNull();

    // Field mappings should be deleted
    const fieldMappingsAfter = await db.fieldMappings.getByIntegrationType(integration.type);
    expect(fieldMappingsAfter).toHaveLength(0);

    // Global integration should be deleted
    const integrationAfter = await db.integrations.findByType(integration.type);
    expect(integrationAfter).toBeNull();
  });

  it('should delete project integrations across multiple projects', async () => {
    // Create second project
    const project2 = await createTestProject(db, { name: 'Test Project 2', created_by: userId });

    // Create global integration
    const integration = await db.integrations.create({
      type: 'jira_multi_project',
      name: 'Multi-Project Jira',
      status: 'active',
      is_custom: false,
      plugin_source: 'builtin',
      trust_level: 'builtin',
    });

    // Create project integrations for both projects
    await db.projectIntegrations.create({
      project_id: projectId,
      integration_id: integration.id,
      enabled: true,
      config: { projectKey: 'PROJ1' },
    });

    await db.projectIntegrations.create({
      project_id: project2.id,
      integration_id: integration.id,
      enabled: true,
      config: { projectKey: 'PROJ2' },
    });

    // Delete the global integration (wrapped in transaction for atomicity)
    const result = await db.transaction(async (tx) => {
      const deletedCount = await tx.projectIntegrations.deleteByPlatform(integration.type);
      await tx.integrations.delete(integration.id);
      return { deletedCount };
    });

    // Verify both project integrations were deleted
    expect(result.deletedCount).toBe(2);

    const project1Integration = await db.projectIntegrations.findByProjectAndPlatform(
      projectId,
      integration.type
    );
    expect(project1Integration).toBeNull();

    const project2Integration = await db.projectIntegrations.findByProjectAndPlatform(
      project2.id,
      integration.type
    );
    expect(project2Integration).toBeNull();
  });

  it('should rollback all deletions if transaction fails', async () => {
    // Create global integration
    const integration = await db.integrations.create({
      type: 'jira_rollback_test',
      name: 'Rollback Test Integration',
      status: 'active',
      is_custom: false,
      plugin_source: 'builtin',
      trust_level: 'builtin',
    });

    // Create project integration
    const projectIntegration = await db.projectIntegrations.create({
      project_id: projectId,
      integration_id: integration.id,
      enabled: true,
      config: { projectKey: 'ROLLBACK' },
    });

    // Create OAuth token
    await db.oauthTokens.create({
      integration_type: integration.type,
      access_token: 'rollback_test_token',
      refresh_token: 'rollback_refresh_token',
    });

    // Create field mapping
    await db.fieldMappings.create({
      integration_type: integration.type,
      source_field: 'status',
      target_field: 'state',
      transform_type: 'direct',
      required: true,
    });

    // Attempt deletion with intentional failure (constraint violation to trigger error)
    await expect(
      db.transaction(async (tx) => {
        await tx.projectIntegrations.deleteByPlatform(integration.type);
        await tx.oauthTokens.deleteByIntegrationType(integration.type);
        await tx.fieldMappings.deleteByIntegrationType(integration.type);

        // Force an error by violating unique constraint (duplicate integration type)
        await tx.integrations.create({
          type: integration.type, // Duplicate type - violates unique constraint
          name: 'Duplicate Integration',
          status: 'active',
          is_custom: false,
          plugin_source: 'builtin',
          trust_level: 'builtin',
        });
      })
    ).rejects.toThrow();

    // Verify nothing was deleted due to transaction rollback
    const integrationAfter = await db.integrations.findByType(integration.type);
    expect(integrationAfter).toBeDefined();
    expect(integrationAfter?.id).toBe(integration.id);

    const projectIntegrationAfter = await db.projectIntegrations.findByProjectAndPlatform(
      projectId,
      integration.type
    );
    expect(projectIntegrationAfter).toBeDefined();
    expect(projectIntegrationAfter?.id).toBe(projectIntegration.id);

    const oauthTokenAfter = await db.oauthTokens.findByIntegrationType(integration.type);
    expect(oauthTokenAfter).toBeDefined();

    const fieldMappingsAfter = await db.fieldMappings.getByIntegrationType(integration.type);
    expect(fieldMappingsAfter).toHaveLength(1);
  });
});
