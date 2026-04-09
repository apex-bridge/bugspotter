/**
 * Share Token Repository Tests
 * Comprehensive tests for share token management operations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { generateShareToken, hashPassword } from '../../src/utils/token-generator.js';
import type { User, Project, BugReport } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('ShareTokenRepository', () => {
  let db: DatabaseClient;
  let testUser: User;
  let testProject: Project;
  let testBugReport: BugReport;
  let createdTokenIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Create test user
    testUser = await db.users.create({
      email: `sharetoken-test-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });

    // Create test project
    testProject = await db.projects.create({
      name: 'Share Token Test Project',
      created_by: testUser.id,
    });

    // Create test bug report
    testBugReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Test Bug for Sharing',
      description: 'Bug report for share token tests',
      status: 'open',
      priority: 'medium',
      metadata: {},
    });
  });

  afterAll(async () => {
    // Cleanup created share tokens
    for (const id of createdTokenIds) {
      try {
        await db.shareTokens.delete(id);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Cleanup test data
    if (testBugReport?.id) await db.bugReports.delete(testBugReport.id);
    if (testProject?.id) await db.projects.delete(testProject.id);
    if (testUser?.id) await db.users.delete(testUser.id);

    await db.close();
  });

  beforeEach(() => {
    createdTokenIds = [];
  });

  // Helper function to create test share token data
  function createTestShareTokenData(overrides = {}) {
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Expires in 24 hours

    return {
      bug_report_id: testBugReport.id,
      token,
      expires_at: expiresAt,
      password_hash: null,
      created_by: testUser.id,
      ...overrides,
    };
  }

  describe('CRUD Operations', () => {
    it('should create a share token', async () => {
      const tokenData = createTestShareTokenData();
      const shareToken = await db.shareTokens.create(tokenData);
      createdTokenIds.push(shareToken.id);

      expect(shareToken).toBeDefined();
      expect(shareToken.id).toBeDefined();
      expect(shareToken.token).toBe(tokenData.token);
      expect(shareToken.bug_report_id).toBe(testBugReport.id);
      expect(shareToken.expires_at).toBeInstanceOf(Date);
      expect(shareToken.view_count).toBe(0);
      expect(shareToken.created_by).toBe(testUser.id);
      expect(shareToken.password_hash).toBeNull();
    });

    it('should create a password-protected share token', async () => {
      const passwordHash = await hashPassword('secure-password');
      const tokenData = createTestShareTokenData({ password_hash: passwordHash });
      const shareToken = await db.shareTokens.create(tokenData);
      createdTokenIds.push(shareToken.id);

      expect(shareToken.password_hash).toBe(passwordHash);
    });

    it('should find share token by token string', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const found = await db.shareTokens.findByToken(tokenData.token);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.token).toBe(tokenData.token);
    });

    it('should return null for non-existent token', async () => {
      const found = await db.shareTokens.findByToken(
        'non-existent-token-string-12345678901234567890'
      );

      expect(found).toBeNull();
    });

    it('should return null for expired token', async () => {
      const createdDate = new Date();
      createdDate.setHours(createdDate.getHours() - 2); // Created 2 hours ago
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 1); // Expired 1 hour ago

      const tokenData = createTestShareTokenData({
        created_at: createdDate,
        expires_at: expiredDate,
      });
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const found = await db.shareTokens.findByToken(tokenData.token);

      expect(found).toBeNull(); // Should not return expired tokens
    });

    it('should delete share token by ID', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);

      const deleted = await db.shareTokens.delete(created.id);
      expect(deleted).toBe(true);

      const found = await db.shareTokens.findById(created.id);
      expect(found).toBeNull();
    });
  });

  describe('findByBugReportId', () => {
    it('should find all tokens for a bug report', async () => {
      const token1 = await db.shareTokens.create(createTestShareTokenData());
      const token2 = await db.shareTokens.create(createTestShareTokenData());
      const token3 = await db.shareTokens.create(createTestShareTokenData());
      createdTokenIds.push(token1.id, token2.id, token3.id);

      const tokens = await db.shareTokens.findByBugReportId(testBugReport.id);

      expect(tokens.length).toBeGreaterThanOrEqual(3);
      expect(tokens.some((t) => t.id === token1.id)).toBe(true);
      expect(tokens.some((t) => t.id === token2.id)).toBe(true);
      expect(tokens.some((t) => t.id === token3.id)).toBe(true);
    });

    it('should filter to only active tokens when activeOnly=true', async () => {
      const createdDate = new Date();
      createdDate.setHours(createdDate.getHours() - 2);
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 1);

      const activeToken = await db.shareTokens.create(createTestShareTokenData());
      const expiredToken = await db.shareTokens.create(
        createTestShareTokenData({ created_at: createdDate, expires_at: expiredDate })
      );
      createdTokenIds.push(activeToken.id, expiredToken.id);

      const allTokens = await db.shareTokens.findByBugReportId(testBugReport.id, false);
      const activeTokens = await db.shareTokens.findByBugReportId(testBugReport.id, true);

      expect(allTokens.length).toBeGreaterThanOrEqual(2);
      expect(activeTokens.some((t) => t.id === activeToken.id)).toBe(true);
      expect(activeTokens.some((t) => t.id === expiredToken.id)).toBe(false);
    });

    it('should return empty array for bug report with no tokens', async () => {
      const anotherBugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Another Bug',
        status: 'open',
        priority: 'low',
        metadata: {},
      });

      const tokens = await db.shareTokens.findByBugReportId(anotherBugReport.id);

      expect(tokens).toEqual([]);

      await db.bugReports.delete(anotherBugReport.id);
    });
  });

  describe('incrementViewCount', () => {
    it('should increment view count by 1', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const newCount = await db.shareTokens.incrementViewCount(tokenData.token);
      expect(newCount).toBe(1);

      const updated = await db.shareTokens.findById(created.id);
      expect(updated?.view_count).toBe(1);
    });

    it('should increment view count multiple times', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const count1 = await db.shareTokens.incrementViewCount(tokenData.token);
      expect(count1).toBe(1);

      const count2 = await db.shareTokens.incrementViewCount(tokenData.token);
      expect(count2).toBe(2);

      const count3 = await db.shareTokens.incrementViewCount(tokenData.token);
      expect(count3).toBe(3);

      const updated = await db.shareTokens.findById(created.id);
      expect(updated?.view_count).toBe(3);
    });

    it('should throw error for non-existent token', async () => {
      await expect(
        db.shareTokens.incrementViewCount('non-existent-token-12345678901234567890')
      ).rejects.toThrow('Share token not found or is no longer valid');
    });
  });

  describe('deleteByToken', () => {
    it('should soft delete token by token string', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const deleted = await db.shareTokens.deleteByToken(tokenData.token);
      expect(deleted).toBe(true);

      // Should not be found after deletion
      const found = await db.shareTokens.findByToken(tokenData.token);
      expect(found).toBeNull();
    });

    it('should return false for non-existent token', async () => {
      const deleted = await db.shareTokens.deleteByToken('non-existent-token-12345678901234567890');
      expect(deleted).toBe(false);
    });

    it('should return false when deleting already deleted token', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      await db.shareTokens.deleteByToken(tokenData.token);
      const secondDelete = await db.shareTokens.deleteByToken(tokenData.token);

      expect(secondDelete).toBe(false);
    });
  });

  describe('deleteByBugReportId', () => {
    it('should delete all tokens for a bug report', async () => {
      const token1 = await db.shareTokens.create(createTestShareTokenData());
      const token2 = await db.shareTokens.create(createTestShareTokenData());
      const token3 = await db.shareTokens.create(createTestShareTokenData());
      createdTokenIds.push(token1.id, token2.id, token3.id);

      const deletedCount = await db.shareTokens.deleteByBugReportId(testBugReport.id);

      expect(deletedCount).toBeGreaterThanOrEqual(3);

      // Verify tokens are not found
      const found1 = await db.shareTokens.findByToken(token1.token);
      const found2 = await db.shareTokens.findByToken(token2.token);
      const found3 = await db.shareTokens.findByToken(token3.token);

      expect(found1).toBeNull();
      expect(found2).toBeNull();
      expect(found3).toBeNull();
    });

    it('should return 0 for bug report with no tokens', async () => {
      const anotherBugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug with no shares',
        status: 'open',
        priority: 'low',
        metadata: {},
      });

      const deletedCount = await db.shareTokens.deleteByBugReportId(anotherBugReport.id);

      expect(deletedCount).toBe(0);

      await db.bugReports.delete(anotherBugReport.id);
    });
  });

  describe('deleteExpired', () => {
    it('should delete only expired tokens', async () => {
      const createdDate = new Date();
      createdDate.setHours(createdDate.getHours() - 3);
      const expiredDate1 = new Date();
      expiredDate1.setHours(expiredDate1.getHours() - 2);
      const expiredDate2 = new Date();
      expiredDate2.setHours(expiredDate2.getHours() - 1);

      const expiredToken1 = await db.shareTokens.create(
        createTestShareTokenData({ created_at: createdDate, expires_at: expiredDate1 })
      );
      const expiredToken2 = await db.shareTokens.create(
        createTestShareTokenData({ created_at: createdDate, expires_at: expiredDate2 })
      );
      const activeToken = await db.shareTokens.create(createTestShareTokenData());
      createdTokenIds.push(expiredToken1.id, expiredToken2.id, activeToken.id);

      const deletedCount = await db.shareTokens.deleteExpired();

      expect(deletedCount).toBeGreaterThanOrEqual(2);

      // Active token should still exist
      const found = await db.shareTokens.findByToken(activeToken.token);
      expect(found).not.toBeNull();
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token without password', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const verified = await db.shareTokens.verifyToken(tokenData.token);

      expect(verified).not.toBeNull();
      expect(verified?.id).toBe(created.id);
    });

    it('should verify valid token with correct password', async () => {
      const password = 'correct-password';
      const passwordHash = await hashPassword(password);
      const tokenData = createTestShareTokenData({ password_hash: passwordHash });
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const verified = await db.shareTokens.verifyToken(tokenData.token, password);

      expect(verified).not.toBeNull();
      expect(verified?.id).toBe(created.id);
    });

    it('should return null for password-protected token without password', async () => {
      const passwordHash = await hashPassword('required-password');
      const tokenData = createTestShareTokenData({ password_hash: passwordHash });
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const verified = await db.shareTokens.verifyToken(tokenData.token);

      expect(verified).toBeNull();
    });

    it('should return null for password-protected token with wrong password', async () => {
      const correctPassword = 'correct-password';
      const wrongPassword = 'wrong-password';
      const passwordHash = await hashPassword(correctPassword);
      const tokenData = createTestShareTokenData({ password_hash: passwordHash });
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const verified = await db.shareTokens.verifyToken(tokenData.token, wrongPassword);

      expect(verified).toBeNull();
    });

    it('should return null for non-existent token', async () => {
      const verified = await db.shareTokens.verifyToken('non-existent-token-12345678901234567890');

      expect(verified).toBeNull();
    });

    it('should return null for expired token', async () => {
      const createdDate = new Date();
      createdDate.setHours(createdDate.getHours() - 2);
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 1);
      const tokenData = createTestShareTokenData({
        created_at: createdDate,
        expires_at: expiredDate,
      });
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const verified = await db.shareTokens.verifyToken(tokenData.token);

      expect(verified).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true for valid existing token', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const exists = await db.shareTokens.exists(tokenData.token);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent token', async () => {
      const exists = await db.shareTokens.exists('non-existent-token-12345678901234567890');

      expect(exists).toBe(false);
    });

    it('should return false for expired token', async () => {
      const createdDate = new Date();
      createdDate.setHours(createdDate.getHours() - 2);
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 1);
      const tokenData = createTestShareTokenData({
        created_at: createdDate,
        expires_at: expiredDate,
      });
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      const exists = await db.shareTokens.exists(tokenData.token);

      expect(exists).toBe(false);
    });

    it('should return false for soft-deleted token', async () => {
      const tokenData = createTestShareTokenData();
      const created = await db.shareTokens.create(tokenData);
      createdTokenIds.push(created.id);

      await db.shareTokens.deleteByToken(tokenData.token);
      const exists = await db.shareTokens.exists(tokenData.token);

      expect(exists).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const createdDate = new Date();
      createdDate.setHours(createdDate.getHours() - 2);
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 1);

      const token1 = await db.shareTokens.create(createTestShareTokenData());
      const token2 = await db.shareTokens.create(createTestShareTokenData());
      const expiredToken = await db.shareTokens.create(
        createTestShareTokenData({ created_at: createdDate, expires_at: expiredDate })
      );
      createdTokenIds.push(token1.id, token2.id, expiredToken.id);

      // Add some views
      await db.shareTokens.incrementViewCount(token1.token);
      await db.shareTokens.incrementViewCount(token1.token);
      await db.shareTokens.incrementViewCount(token2.token);

      const stats = await db.shareTokens.getStats(testBugReport.id);

      expect(stats.count).toBeGreaterThanOrEqual(3);
      expect(stats.active_count).toBeGreaterThanOrEqual(2);
      expect(stats.total_views).toBeGreaterThanOrEqual(3);
    });

    it('should return zero stats for bug report with no tokens', async () => {
      const anotherBugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug with no tokens',
        status: 'open',
        priority: 'low',
        metadata: {},
      });

      const stats = await db.shareTokens.getStats(anotherBugReport.id);

      expect(stats.count).toBe(0);
      expect(stats.active_count).toBe(0);
      expect(stats.total_views).toBe(0);

      await db.bugReports.delete(anotherBugReport.id);
    });
  });

  describe('Database Constraints', () => {
    it('should enforce minimum token length constraint', async () => {
      const shortToken = 'x'.repeat(31); // 31 characters (below minimum of 32)
      const tokenData = createTestShareTokenData({ token: shortToken });

      await expect(db.shareTokens.create(tokenData)).rejects.toThrow();
    });

    it('should enforce expires_at > created_at constraint', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      const tokenData = createTestShareTokenData({ expires_at: pastDate });

      await expect(db.shareTokens.create(tokenData)).rejects.toThrow();
    });

    it('should enforce unique token constraint', async () => {
      const token = generateShareToken();
      const tokenData1 = createTestShareTokenData({ token });
      const tokenData2 = createTestShareTokenData({ token });

      const created = await db.shareTokens.create(tokenData1);
      createdTokenIds.push(created.id);

      await expect(db.shareTokens.create(tokenData2)).rejects.toThrow();
    });

    it('should cascade delete when bug report is deleted', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug for cascade test',
        status: 'open',
        priority: 'low',
        metadata: {},
      });

      const tokenData = createTestShareTokenData({ bug_report_id: bugReport.id });
      const token = await db.shareTokens.create(tokenData);

      // Delete bug report
      await db.bugReports.delete(bugReport.id);

      // Token should be cascade deleted
      const found = await db.shareTokens.findById(token.id);
      expect(found).toBeNull();
    });
  });
});
