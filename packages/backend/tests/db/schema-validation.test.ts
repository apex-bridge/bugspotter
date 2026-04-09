/**
 * Schema Validation Tests
 *
 * Ensures the squashed migration (001_initial_schema.sql) contains all
 * constraints and indexes from individual migrations 002-014.
 *
 * These tests prevent regressions when squashing migrations by validating:
 * - CHECK constraints exist and enforce data integrity
 * - Indexes exist for performance optimization
 * - Partial indexes have correct WHERE clauses
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client';

describe('Schema Validation', () => {
  let db: DatabaseClient;

  beforeAll(async () => {
    db = createDatabaseClient();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('project_integrations constraints', () => {
    it('should enforce check_error_count constraint (error_count >= 0)', async () => {
      await expect(
        db.query(`
          INSERT INTO project_integrations (
            project_id, integration_id, error_count
          ) VALUES (
            gen_random_uuid(), 
            (SELECT id FROM integrations WHERE type = 'jira' LIMIT 1),
            -1
          )
        `)
      ).rejects.toThrow(/check_error_count|violates check constraint/i);
    });

    it('should enforce check_disabled_consistency constraint (disabled_at and disabled_reason must both be set or both be null)', async () => {
      // Case 1: disabled_at is set but disabled_reason is null (should fail)
      await expect(
        db.query(`
          INSERT INTO project_integrations (
            project_id, integration_id, disabled_at, disabled_reason
          ) VALUES (
            gen_random_uuid(),
            (SELECT id FROM integrations WHERE type = 'jira' LIMIT 1),
            NOW(),
            NULL
          )
        `)
      ).rejects.toThrow(/check_disabled_consistency|violates check constraint/i);

      // Case 2: disabled_reason is set but disabled_at is null (should fail)
      await expect(
        db.query(`
          INSERT INTO project_integrations (
            project_id, integration_id, disabled_at, disabled_reason
          ) VALUES (
            gen_random_uuid(),
            (SELECT id FROM integrations WHERE type = 'jira' LIMIT 1),
            NULL,
            'Test reason'
          )
        `)
      ).rejects.toThrow(/check_disabled_consistency|violates check constraint/i);
    });

    it('should allow valid disabled state (both disabled_at and disabled_reason set)', async () => {
      const projectId = (
        await db.query('INSERT INTO projects (name) VALUES ($1) RETURNING id', ['Test Project'])
      ).rows[0].id;

      const integrationId = (
        await db.query("SELECT id FROM integrations WHERE type = 'jira' LIMIT 1")
      ).rows[0]?.id;

      if (!integrationId) {
        throw new Error('Jira integration not found - ensure seed data is loaded');
      }

      const result = await db.query(
        `
          INSERT INTO project_integrations (
            project_id, integration_id, disabled_at, disabled_reason
          ) VALUES ($1, $2, NOW(), $3)
          RETURNING id
        `,
        [projectId, integrationId, 'Too many errors']
      );

      expect(result.rows[0].id).toBeDefined();

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [result.rows[0].id]);
      await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
    });

    it('should allow valid enabled state (both disabled_at and disabled_reason null)', async () => {
      const projectId = (
        await db.query('INSERT INTO projects (name) VALUES ($1) RETURNING id', ['Test Project 2'])
      ).rows[0].id;

      const integrationId = (
        await db.query("SELECT id FROM integrations WHERE type = 'jira' LIMIT 1")
      ).rows[0]?.id;

      const result = await db.query(
        `
          INSERT INTO project_integrations (
            project_id, integration_id, disabled_at, disabled_reason, error_count
          ) VALUES ($1, $2, NULL, NULL, 0)
          RETURNING id
        `,
        [projectId, integrationId]
      );

      expect(result.rows[0].id).toBeDefined();

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [result.rows[0].id]);
      await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
    });
  });

  describe('project_integrations indexes', () => {
    it('should have idx_project_integrations_disabled partial index', async () => {
      const result = await db.query(`
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes 
        WHERE tablename = 'project_integrations' 
        AND indexname = 'idx_project_integrations_disabled'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].indexdef).toContain('WHERE (disabled_at IS NOT NULL)');
    });

    it('should have idx_project_integrations_error_count partial index', async () => {
      const result = await db.query(`
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes 
        WHERE tablename = 'project_integrations' 
        AND indexname = 'idx_project_integrations_error_count'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].indexdef).toContain('WHERE (error_count > 0)');
    });

    it('should have all expected project_integrations indexes', async () => {
      const result = await db.query(`
        SELECT indexname
        FROM pg_indexes 
        WHERE tablename = 'project_integrations'
        ORDER BY indexname
      `);

      const indexNames = result.rows.map((r) => r.indexname);

      // Expected indexes for circuit breaker
      const expectedIndexes = [
        'idx_project_integrations_disabled',
        'idx_project_integrations_enabled',
        'idx_project_integrations_error_count',
        'idx_project_integrations_integration_id',
        'idx_project_integrations_project',
      ];

      for (const expectedIndex of expectedIndexes) {
        expect(indexNames).toContain(expectedIndex);
      }
    });
  });

  describe('share_tokens constraints', () => {
    it('should enforce check_token_format constraint (length >= 32)', async () => {
      await expect(
        db.query(`
          INSERT INTO share_tokens (
            bug_report_id, token, expires_at
          ) VALUES (
            gen_random_uuid(),
            'short',
            NOW() + '1 day'::interval
          )
        `)
      ).rejects.toThrow(/check_token_format|violates check constraint/i);
    });

    it('should enforce check_expires_future constraint (expires_at > created_at)', async () => {
      await expect(
        db.query(`
          INSERT INTO share_tokens (
            bug_report_id, token, expires_at, created_at
          ) VALUES (
            gen_random_uuid(),
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            NOW() - '1 day'::interval,
            NOW()
          )
        `)
      ).rejects.toThrow(/check_expires_future|violates check constraint/i);
    });
  });

  describe('users table constraints', () => {
    it('should enforce check_auth_method constraint', async () => {
      // Both password and OAuth set (invalid)
      await expect(
        db.query(`
          INSERT INTO users (email, password_hash, oauth_provider, oauth_id)
          VALUES ('test@example.com', 'hash123', 'google', 'oauth123')
        `)
      ).rejects.toThrow(/check_auth_method|violates check constraint/i);

      // Neither password nor OAuth set (invalid)
      await expect(
        db.query(`
          INSERT INTO users (email)
          VALUES ('test2@example.com')
        `)
      ).rejects.toThrow(/check_auth_method|violates check constraint/i);
    });
  });

  describe('bug_reports constraints', () => {
    it('should enforce check_upload_status constraint', async () => {
      await expect(
        db.query(`
          INSERT INTO bug_reports (
            project_id, title, upload_status
          ) VALUES (
            gen_random_uuid(),
            'Test',
            'invalid_status'
          )
        `)
      ).rejects.toThrow(/check_upload_status|violates check constraint/i);
    });

    it('should enforce check_replay_upload_status constraint', async () => {
      await expect(
        db.query(`
          INSERT INTO bug_reports (
            project_id, title, replay_upload_status
          ) VALUES (
            gen_random_uuid(),
            'Test',
            'invalid_replay_status'
          )
        `)
      ).rejects.toThrow(/check_replay_upload_status|violates check constraint/i);
    });
  });

  describe('Critical indexes exist', () => {
    it('should have performance indexes for active reports', async () => {
      const result = await db.query(`
        SELECT tablename, indexname
        FROM pg_indexes
        WHERE indexname IN (
          'idx_bug_reports_active_project_status_created',
          'idx_bug_reports_active_project_priority_created',
          'idx_projects_created_by_id'
        )
        ORDER BY indexname
      `);

      expect(result.rows).toHaveLength(3);

      // Verify these are partial indexes with correct WHERE clauses
      const partialIndexCheck = await db.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE indexname LIKE 'idx_bug_reports_active_project%'
      `);

      expect(partialIndexCheck.rows).toHaveLength(2);
      partialIndexCheck.rows.forEach((row) => {
        expect(row.indexdef).toContain('WHERE (deleted_at IS NULL)');
      });
    });

    it('should have partial indexes with correct WHERE clauses', async () => {
      const partialIndexes = await db.query(`
        SELECT 
          tablename,
          indexname,
          indexdef
        FROM pg_indexes
        WHERE indexdef LIKE '%WHERE%'
        AND tablename IN ('bug_reports', 'project_integrations', 'share_tokens', 'tickets')
        ORDER BY tablename, indexname
      `);

      // Verify at least these critical partial indexes exist
      const indexNames = partialIndexes.rows.map((r) => r.indexname);

      expect(indexNames).toContain('idx_bug_reports_deleted_at');
      expect(indexNames).toContain('idx_bug_reports_legal_hold');
      expect(indexNames).toContain('idx_project_integrations_disabled');
      expect(indexNames).toContain('idx_project_integrations_error_count');
    });
  });
});
