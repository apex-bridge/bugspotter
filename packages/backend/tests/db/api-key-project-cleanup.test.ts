/**
 * API Key Project Cleanup Tests
 * Tests for PostgreSQL trigger that removes orphaned project references
 * from api_keys.allowed_projects when projects are deleted
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { User } from '../../src/db/types.js';

describe('API Key Project Cleanup Trigger', () => {
  let db: DatabaseClient;
  let testUser: User;
  let createdUserIds: string[] = [];
  let createdProjectIds: string[] = [];
  let createdApiKeyIds: string[] = [];

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    // Create test user
    testUser = await db.users.create({
      email: `test-${Date.now()}@example.com`,
      password_hash: 'hash',
      name: 'Test User',
      role: 'admin',
    });
    createdUserIds.push(testUser.id);
  });

  afterEach(async () => {
    // Clean up in reverse dependency order
    // 1. Delete API keys
    for (const keyId of createdApiKeyIds) {
      try {
        await db.apiKeys.delete(keyId);
      } catch {
        // Ignore if already deleted
      }
    }

    // 2. Delete projects
    for (const projectId of createdProjectIds) {
      try {
        await db.projects.delete(projectId);
      } catch {
        // Ignore if already deleted
      }
    }

    // 3. Delete users
    for (const userId of createdUserIds) {
      try {
        await db.users.delete(userId);
      } catch {
        // Ignore if already deleted
      }
    }

    // Reset tracking arrays
    createdApiKeyIds = [];
    createdProjectIds = [];
    createdUserIds = [];
  });

  describe('Trigger: cleanup_api_keys_on_project_delete', () => {
    it('should remove deleted project UUID from allowed_projects array', async () => {
      // Create two projects
      const project1 = await db.projects.create({
        name: 'Project 1',
        settings: {},
        created_by: testUser.id,
      });
      createdProjectIds.push(project1.id);

      const project2 = await db.projects.create({
        name: 'Project 2',
        settings: {},
        created_by: testUser.id,
      });
      createdProjectIds.push(project2.id);

      // Create API key with both projects in allowed_projects
      const apiKey = await db.apiKeys.create({
        key_hash: 'test_hash_' + Date.now(),
        key_prefix: 'bgs_test',
        key_suffix: 'abcd1234',
        name: 'Test Key',
        type: 'production',
        permission_scope: 'full',
        permissions: [],
        allowed_projects: [project1.id, project2.id],
        created_by: testUser.id,
      });
      createdApiKeyIds.push(apiKey.id);

      // Verify both projects are in allowed_projects
      let fetchedKey = await db.apiKeys.findById(apiKey.id);
      expect(fetchedKey?.allowed_projects).toEqual(
        expect.arrayContaining([project1.id, project2.id])
      );
      expect(fetchedKey?.allowed_projects).toHaveLength(2);

      // Delete project1
      await db.projects.delete(project1.id);

      // Verify project1 UUID was removed from allowed_projects
      fetchedKey = await db.apiKeys.findById(apiKey.id);
      expect(fetchedKey?.allowed_projects).toEqual([project2.id]);
      expect(fetchedKey?.allowed_projects).not.toContain(project1.id);
      expect(fetchedKey?.allowed_projects).toHaveLength(1);
    });

    it('should revoke API key when all projects are deleted', async () => {
      // Create one project
      const project = await db.projects.create({
        name: 'Single Project',
        settings: {},
        created_by: testUser.id,
      });
      createdProjectIds.push(project.id);

      // Create API key with single project
      const apiKey = await db.apiKeys.create({
        key_hash: 'test_hash_single_' + Date.now(),
        key_prefix: 'bgs_test',
        key_suffix: 'xyz98765',
        name: 'Single Project Key',
        type: 'development',
        permission_scope: 'full',
        permissions: [],
        allowed_projects: [project.id],
        created_by: testUser.id,
      });
      createdApiKeyIds.push(apiKey.id);

      // Verify API key is initially active
      let fetchedKey = await db.apiKeys.findById(apiKey.id);
      expect(fetchedKey?.status).toBe('active');
      expect(fetchedKey?.revoked_at).toBeNull();

      // Delete the project
      await db.projects.delete(project.id);

      // Verify API key was automatically revoked
      fetchedKey = await db.apiKeys.findById(apiKey.id);
      expect(fetchedKey?.allowed_projects).toEqual([]);
      expect(fetchedKey?.status).toBe('revoked');
      expect(fetchedKey?.revoked_at).not.toBeNull();
    });

    it('should handle multiple API keys with same project', async () => {
      // Create one project
      const project = await db.projects.create({
        name: 'Shared Project',
        settings: {},
        created_by: testUser.id,
      });
      createdProjectIds.push(project.id);

      // Create multiple API keys with the same project
      const apiKey1 = await db.apiKeys.create({
        key_hash: 'test_hash_multi1_' + Date.now(),
        key_prefix: 'bgs_test1',
        key_suffix: 'aaaa1111',
        name: 'Key 1',
        type: 'production',
        permission_scope: 'full',
        permissions: [],
        allowed_projects: [project.id],
        created_by: testUser.id,
      });
      createdApiKeyIds.push(apiKey1.id);

      const apiKey2 = await db.apiKeys.create({
        key_hash: 'test_hash_multi2_' + Date.now(),
        key_prefix: 'bgs_test2',
        key_suffix: 'bbbb2222',
        name: 'Key 2',
        type: 'production',
        permission_scope: 'full',
        permissions: [],
        allowed_projects: [project.id],
        created_by: testUser.id,
      });
      createdApiKeyIds.push(apiKey2.id);

      // Delete the project
      await db.projects.delete(project.id);

      // Verify both API keys were revoked (they had only this project)
      const fetchedKey1 = await db.apiKeys.findById(apiKey1.id);
      const fetchedKey2 = await db.apiKeys.findById(apiKey2.id);

      expect(fetchedKey1?.allowed_projects).toEqual([]);
      expect(fetchedKey1?.status).toBe('revoked');
      expect(fetchedKey2?.allowed_projects).toEqual([]);
      expect(fetchedKey2?.status).toBe('revoked');
    });

    it('should not affect API keys without allowed_projects', async () => {
      // Create project
      const project = await db.projects.create({
        name: 'Test Project',
        settings: {},
        created_by: testUser.id,
      });
      createdProjectIds.push(project.id);

      // Create API key with NULL allowed_projects (all projects access)
      const apiKey = await db.apiKeys.create({
        key_hash: 'test_hash_null_' + Date.now(),
        key_prefix: 'bgs_null',
        key_suffix: 'cccc3333',
        name: 'Unrestricted Key',
        type: 'production',
        permission_scope: 'full',
        permissions: [],
        allowed_projects: null,
        created_by: testUser.id,
      });
      createdApiKeyIds.push(apiKey.id);

      // Delete the project
      await db.projects.delete(project.id);

      // Verify allowed_projects is still NULL
      const fetchedKey = await db.apiKeys.findById(apiKey.id);
      expect(fetchedKey?.allowed_projects).toBeNull();
    });

    it('should update updated_at timestamp when cleaning', async () => {
      // Create project
      const project = await db.projects.create({
        name: 'Timestamp Test Project',
        settings: {},
        created_by: testUser.id,
      });
      createdProjectIds.push(project.id);

      // Create API key
      const apiKey = await db.apiKeys.create({
        key_hash: 'test_hash_ts_' + Date.now(),
        key_prefix: 'bgs_ts',
        key_suffix: 'dddd4444',
        name: 'Timestamp Key',
        type: 'production',
        permission_scope: 'full',
        permissions: [],
        allowed_projects: [project.id],
        created_by: testUser.id,
      });
      createdApiKeyIds.push(apiKey.id);

      const originalUpdatedAt = apiKey.updated_at;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete the project
      await db.projects.delete(project.id);

      // Verify updated_at was changed
      const fetchedKey = await db.apiKeys.findById(apiKey.id);
      expect(fetchedKey?.updated_at).not.toEqual(originalUpdatedAt);
      expect(new Date(fetchedKey!.updated_at).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });
  });
});
