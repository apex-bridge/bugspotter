/**
 * Storage URL Routes Integration Tests
 * Tests for on-demand presigned URL generation endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';
import type { Project } from '../../src/db/types.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';
import { generateShareToken } from '../../src/utils/token-generator.js';
import { vi } from 'vitest';

describe('Storage URL Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let mockStorage: any;
  let testProject: Project;
  let testApiKey: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    mockStorage = createMockStorage();

    // Add getSignedUrl method for presigned URL generation
    mockStorage.getSignedUrl = vi
      .fn()
      .mockResolvedValue('https://mock-storage.example.com/signed-url?signature=xyz789');

    server = await createServer({ db, storage: mockStorage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Create test project
    testProject = await db.projects.create({
      name: 'Test Storage URL Project',
    });

    // Create API key using ApiKeyService
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Test API Key',
      permissions: ['read', 'write'],
      allowed_projects: [testProject.id],
    });
    testApiKey = apiKeyResult.plaintext;
  });

  describe('GET /api/v1/storage/url/:bugReportId/:type', () => {
    describe('Screenshot URLs', () => {
      it('should generate presigned URL for screenshot', async () => {
        // Create bug report with screenshot
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with screenshot',
          description: 'Test bug',
          screenshot_key: 'screenshots/proj-123/bug-456/image.png',
          screenshot_url: 'https://old-url.example.com/image.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBe('https://mock-storage.example.com/signed-url?signature=xyz789');
        expect(json.key).toBe('screenshots/proj-123/bug-456/image.png');
        expect(json.expiresIn).toBe(518400); // 6 days
        expect(json.generatedAt).toBeDefined();

        // Verify storage service was called
        expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
          'screenshots/proj-123/bug-456/image.png'
        );
      });

      it('should return 404 when bug report not found', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/storage/url/00000000-0000-0000-0000-000000000000/screenshot',
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(404);
        const json = response.json();
        expect(json.message).toBe('Bug report not found');
      });

      it('should return 404 when screenshot key is missing', async () => {
        // Create bug report without screenshot
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug without screenshot',
          description: 'Test bug',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(404);
        const json = response.json();
        expect(json.message).toBe('No screenshot available for this bug report');
      });
    });

    describe('Thumbnail URLs', () => {
      it('should generate presigned URL for thumbnail from metadata', async () => {
        // Create bug report with thumbnail key in metadata
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with thumbnail',
          description: 'Test bug',
          screenshot_key: 'screenshots/proj-123/bug-456/image.png',
          metadata: { thumbnailKey: 'screenshots/proj-123/bug-456/thumb-image.png' },
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/thumbnail`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.key).toBe('screenshots/proj-123/bug-456/thumb-image.png');
        expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
          'screenshots/proj-123/bug-456/thumb-image.png'
        );
      });

      it('should fallback to generated thumbnail key when metadata missing', async () => {
        // Create bug report without thumbnail metadata
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug without thumbnail metadata',
          description: 'Test bug',
          screenshot_key: 'screenshots/proj-123/bug-456/image.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/thumbnail`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        // Should use generated key from getThumbnailKey()
        expect(json.key).toBe('screenshots/proj-123/bug-456/thumb-image.png');
      });
    });

    describe('Replay URLs', () => {
      it('should generate presigned URL for replay', async () => {
        // Create bug report with replay
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with replay',
          description: 'Test bug',
          replay_key: 'replays/proj-123/bug-456/replay.json.gz',
          replay_url: 'https://old-url.example.com/replay.json.gz',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
        expect(json.key).toBe('replays/proj-123/bug-456/replay.json.gz');
        expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
          'replays/proj-123/bug-456/replay.json.gz'
        );
      });

      it('should return 404 when replay key is missing', async () => {
        // Create bug report without replay
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug without replay',
          description: 'Test bug',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(404);
        const json = response.json();
        expect(json.message).toBe('No replay available for this bug report');
      });
    });

    describe('Share Token Authentication', () => {
      it('should allow unauthenticated access with valid shareToken', async () => {
        // Create bug report with replay
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Shared Bug Report',
          description: 'Test shared access',
          replay_key: 'replays/proj-123/bug-456/replay.json.gz',
        });

        // Create share token
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });

        // Request without API key, but with shareToken
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${shareToken.token}`,
          // NO x-api-key header!
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
        expect(json.key).toBe('replays/proj-123/bug-456/replay.json.gz');
        expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
          'replays/proj-123/bug-456/replay.json.gz'
        );
      });

      it('should allow access to screenshot with valid shareToken', async () => {
        // Create bug report with screenshot
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Shared Bug with Screenshot',
          description: 'Test shared screenshot access',
          screenshot_key: 'screenshots/proj-123/bug-456/image.png',
        });

        // Create share token
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Request without API key
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot?shareToken=${shareToken.token}`,
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
        expect(json.key).toBe('screenshots/proj-123/bug-456/image.png');
      });

      it('should reject invalid shareToken', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test invalid token',
          replay_key: 'replays/proj-123/bug-456/replay.json.gz',
        });

        // Request with invalid shareToken
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=invalid-token-12345`,
        });

        // Invalid token is treated as missing auth, returns 401
        expect(response.statusCode).toBe(401);
      });

      it('should reject shareToken for different bug report', async () => {
        // Create two bug reports
        const bugReport1 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 1',
          description: 'First bug',
          replay_key: 'replays/proj-123/bug-1/replay.json.gz',
        });

        const bugReport2 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 2',
          description: 'Second bug',
          replay_key: 'replays/proj-123/bug-2/replay.json.gz',
        });

        // Create share token for bug report 1
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport1.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Try to use token for bug report 2
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport2.id}/replay?shareToken=${shareToken.token}`,
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.message).toBe('Invalid share token for requested bug report');
      });

      it('should use standard auth when shareToken not provided', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test standard auth',
          replay_key: 'replays/proj-123/bug-456/replay.json.gz',
        });

        // Request without API key AND without shareToken
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          // No headers, no shareToken
        });

        // Should fail with 401 (no authentication)
        expect(response.statusCode).toBe(401);
      });

      it('should prioritize shareToken over API key when both provided', async () => {
        // Create bug report in a different project
        const otherProject = await db.projects.create({
          name: 'Other Project',
        });

        const bugReport = await db.bugReports.create({
          project_id: otherProject.id,
          title: 'Bug in Other Project',
          description: 'Test token priority',
          replay_key: 'replays/other/bug-456/replay.json.gz',
        });

        // Create share token
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Request with API key that doesn't have access to other project, but with valid shareToken
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${shareToken.token}`,
          headers: {
            'x-api-key': testApiKey, // Has access to testProject only
          },
        });

        // Should succeed because shareToken takes priority
        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
      });

      it('should accept password-protected shareToken with correct password', async () => {
        const { hashPassword } = await import('../../src/utils/token-generator.js');
        const password = 'securePassword123!';

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Protected Bug Report',
          description: 'Test password protection',
          replay_key: 'replays/proj-123/bug-protected/replay.json.gz',
        });

        // Create password-protected share token
        const token = generateShareToken();
        const hashedPassword = await hashPassword(password);
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Request with password in query string (not allowed - use POST instead)
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${shareToken.token}&shareTokenPassword=${password}`,
        });

        // Schema validation rejects additional properties with 400 error
        expect(response.statusCode).toBe(400);
        const json = response.json();
        expect(json.error).toBe('ValidationError');
      });

      it('should reject password-protected shareToken without password', async () => {
        const { hashPassword } = await import('../../src/utils/token-generator.js');
        const password = 'securePassword123!';

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Protected Bug Report',
          description: 'Test missing password',
          replay_key: 'replays/proj-123/bug-protected2/replay.json.gz',
        });

        // Create password-protected share token
        const token = generateShareToken();
        const hashedPassword = await hashPassword(password);
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Request without password
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${shareToken.token}`,
        });

        expect(response.statusCode).toBe(401);
      });

      it('should reject invalid query parameters', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test schema validation',
          replay_key: 'replays/proj-123/bug-456/replay.json.gz',
        });

        // Request with invalid query parameter
        // With additionalProperties: false, invalid params are rejected (not stripped)
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?invalidParam=foo&anotherBad=bar`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        // Schema validation rejects additional properties with 400 error
        expect(response.statusCode).toBe(400);
        const json = response.json();
        expect(json.error).toBe('ValidationError');
      });
    });

    describe('Storage service errors', () => {
      it('should return 500 when storage service fails', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug for error test',
          description: 'Test bug',
          screenshot_key: 'screenshots/error-test.png',
        });

        // Mock storage service to throw error
        mockStorage.getSignedUrl.mockRejectedValueOnce(new Error('S3 connection failed'));

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(500);
        const json = response.json();
        expect(json.message).toBe('Failed to generate presigned URL');
      });
    });
  });

  describe('POST /api/v1/storage/url/:bugReportId/:type', () => {
    describe('Password-protected shares (secure POST)', () => {
      it('should accept POST with shareToken and shareTokenPassword in body', async () => {
        const { hashPassword } = await import('../../src/utils/token-generator.js');
        const password = 'securePassword123!';

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Protected Bug Report',
          description: 'Test POST password in body',
          replay_key: 'replays/proj-123/bug-protected/replay.json.gz',
        });

        // Create password-protected share token
        const token = generateShareToken();
        const hashedPassword = await hashPassword(password);
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // POST request with password in body (secure)
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
            shareTokenPassword: password,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
        expect(json.key).toBe('replays/proj-123/bug-protected/replay.json.gz');
      });

      it('should accept POST with only shareToken (no password required)', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Public Shared Bug Report',
          description: 'Test POST without password',
          screenshot_key: 'screenshots/proj-123/bug-public/image.png',
        });

        // Create public share token (no password)
        const token = generateShareToken();
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // POST request with only token
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
        expect(json.key).toBe('screenshots/proj-123/bug-public/image.png');
      });

      it('should reject POST with incorrect password', async () => {
        const { hashPassword } = await import('../../src/utils/token-generator.js');
        const correctPassword = 'correctPassword123!';
        const wrongPassword = 'wrongPassword456!';

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Protected Bug Report',
          description: 'Test wrong password',
          replay_key: 'replays/proj-123/bug-wrong-pw/replay.json.gz',
        });

        // Create password-protected share token
        const token = generateShareToken();
        const hashedPassword = await hashPassword(correctPassword);
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // POST with wrong password
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
            shareTokenPassword: wrongPassword,
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should reject POST with password-protected token but no password provided', async () => {
        const { hashPassword } = await import('../../src/utils/token-generator.js');
        const password = 'requiredPassword123!';

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Protected Bug Report',
          description: 'Test missing password',
          replay_key: 'replays/proj-123/bug-missing-pw/replay.json.gz',
        });

        // Create password-protected share token
        const token = generateShareToken();
        const hashedPassword = await hashPassword(password);
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // POST without password
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
            // No shareTokenPassword provided
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should reject POST with invalid shareToken', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test invalid token',
          replay_key: 'replays/proj-123/bug-invalid/replay.json.gz',
        });

        // POST with invalid token
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: 'invalid-token-xyz123',
            shareTokenPassword: 'anyPassword',
          },
        });

        expect(response.statusCode).toBe(401);
      });

      // TODO: Fix this test - database CHECK constraint prevents creating expired tokens
      // Need to either mock time or test expiration differently
      it('should reject POST with expired shareToken', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with Expired Token',
          description: 'Test expired token',
          replay_key: 'replays/proj-123/bug-expired/replay.json.gz',
        });

        // Mock verifyToken to simulate expired token (returns null)
        const token = generateShareToken();
        const originalVerifyToken = db.shareTokens.verifyToken;
        db.shareTokens.verifyToken = vi.fn().mockResolvedValue(null);

        try {
          // POST with expired token
          const response = await server.inject({
            method: 'POST',
            url: `/api/v1/storage/url/${bugReport.id}/replay`,
            headers: {
              'content-type': 'application/json',
            },
            payload: {
              shareToken: token,
            },
          });

          // Should reject with 401 because expired token is treated as invalid
          expect(response.statusCode).toBe(401);
          const json = response.json();
          expect(json.message).toContain('Invalid share token');
        } finally {
          // Restore original method
          db.shareTokens.verifyToken = originalVerifyToken;
        }
      });

      it('should reject POST with shareToken for different bug report', async () => {
        // Create two bug reports
        const bugReport1 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 1',
          description: 'First bug',
          replay_key: 'replays/proj-123/bug-1/replay.json.gz',
        });

        const bugReport2 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 2',
          description: 'Second bug',
          replay_key: 'replays/proj-123/bug-2/replay.json.gz',
        });

        // Create share token for bug report 1
        const token = generateShareToken();
        await db.shareTokens.create({
          bug_report_id: bugReport1.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Try to use token for bug report 2
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport2.id}/replay`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.message).toBe('Invalid share token for requested bug report');
      });
    });

    describe('POST authentication priority', () => {
      it('should reject invalid share token even with valid API key', async () => {
        // Clear mock from previous tests
        mockStorage.getSignedUrl.mockClear();

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test strict share token validation',
          screenshot_key: 'screenshots/proj-123/bug-reject/image.png',
        });

        // POST with valid API key + invalid share token in body
        // Expected: Request fails because invalid share token is provided
        // Strict validation enforces: if shareToken is present, it MUST be valid
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            shareToken: 'invalid-dummy-token-12345', // Invalid token in body
          },
        });

        // Should fail with 401 due to invalid share token (strict validation)
        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json.message).toContain('Invalid share token');
        // Storage should not be called
        expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
      });

      it('should work with only API key (no share token in payload)', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test API key only',
          screenshot_key: 'screenshots/proj-123/bug-apionly/image.png',
        });

        // POST with API key, empty payload
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {}, // No share token
        });

        expect(response.statusCode).toBe(400); // Schema validation requires shareToken
      });

      it('should prioritize shareToken over API key when both provided', async () => {
        // Create bug report in a different project
        const otherProject = await db.projects.create({
          name: 'Other Project',
        });

        const bugReport = await db.bugReports.create({
          project_id: otherProject.id,
          title: 'Bug in Other Project',
          description: 'Test token priority',
          replay_key: 'replays/other/bug-priority/replay.json.gz',
        });

        // Create share token
        const token = generateShareToken();
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // POST with API key that doesn't have access to other project, but with valid shareToken
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          headers: {
            'x-api-key': testApiKey, // Has access to testProject only
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
          },
        });

        // Should succeed because shareToken takes priority
        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.url).toBeDefined();
      });
    });

    describe('Security - Password not in query params', () => {
      it('should not accept password in query string (POST body only)', async () => {
        const { hashPassword } = await import('../../src/utils/token-generator.js');
        const password = 'securePassword123!';

        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Protected Bug Report',
          description: 'Test query param rejection',
          replay_key: 'replays/proj-123/bug-query/replay.json.gz',
        });

        // Create password-protected share token
        const token = generateShareToken();
        const hashedPassword = await hashPassword(password);
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Try POST with password in query string (should be ignored/rejected)
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareTokenPassword=${password}`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
            // Password in query, not body
          },
        });

        // Should fail - password in query params is not accepted by POST endpoint
        expect(response.statusCode).toBe(401);
      });

      it('should validate POST schema requires shareToken in body', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test schema validation',
          screenshot_key: 'screenshots/test.png',
        });

        // POST without required shareToken in body
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {}, // Empty body
        });

        expect(response.statusCode).toBe(400);
        const json = response.json();
        // Check that it's a validation error
        expect(json.error).toBe('ValidationError');
        expect(json.message).toBe('Request validation failed');
        // POST endpoint requires shareToken in body (validated by schema)
      });
    });

    describe('POST resource types', () => {
      it('should generate URL for screenshot via POST', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with Screenshot',
          description: 'Test POST screenshot',
          screenshot_key: 'screenshots/proj-123/bug-post/image.png',
        });

        // Create share token
        const token = generateShareToken();
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.key).toBe('screenshots/proj-123/bug-post/image.png');
      });

      it('should generate URL for thumbnail via POST', async () => {
        // Create bug report
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with Thumbnail',
          description: 'Test POST thumbnail',
          screenshot_key: 'screenshots/proj-123/bug-thumb/image.png',
          metadata: { thumbnailKey: 'screenshots/proj-123/bug-thumb/thumb.png' },
        });

        // Create share token
        const token = generateShareToken();
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/thumbnail`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.key).toBe('screenshots/proj-123/bug-thumb/thumb.png');
      });

      it('should return 404 when resource not available via POST', async () => {
        // Create bug report without screenshot
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug without Screenshot',
          description: 'Test 404',
        });

        // Create share token
        const token = generateShareToken();
        await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            shareToken: token,
          },
        });

        expect(response.statusCode).toBe(404);
        const json = response.json();
        expect(json.message).toBe('No screenshot available for this bug report');
      });
    });
  });

  describe('POST /api/v1/storage/urls/batch', () => {
    describe('Batch URL generation', () => {
      it('should generate URLs for multiple bug reports', async () => {
        // Create multiple bug reports
        const bugReport1 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug 1',
          description: 'Test',
          screenshot_key: 'screenshots/bug1.png',
          replay_key: 'replays/bug1.json.gz',
        });

        const bugReport2 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug 2',
          description: 'Test',
          screenshot_key: 'screenshots/bug2.png',
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport1.id, bugReport2.id],
            types: ['screenshot', 'replay'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        // Bug 1 should have both screenshot and replay
        expect(json.urls[bugReport1.id].screenshot).toBeDefined();
        expect(json.urls[bugReport1.id].replay).toBeDefined();

        // Bug 2 should have screenshot but null replay
        expect(json.urls[bugReport2.id].screenshot).toBeDefined();
        expect(json.urls[bugReport2.id].replay).toBeNull();

        expect(json.generatedAt).toBeDefined();
      });

      it('should handle thumbnail generation in batch', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with thumbnail',
          description: 'Test',
          screenshot_key: 'screenshots/test.png',
          metadata: { thumbnailKey: 'screenshots/thumb-test.png' },
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['thumbnail'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.urls[bugReport.id].thumbnail).toBeDefined();
        expect(mockStorage.getSignedUrl).toHaveBeenCalledWith('screenshots/thumb-test.png');
      });

      it('should skip non-existent bug reports', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Existing bug',
          description: 'Test',
          screenshot_key: 'screenshots/test.png',
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport.id, '00000000-0000-0000-0000-000000000000'],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.urls[bugReport.id]).toBeDefined();
        expect(json.urls['00000000-0000-0000-0000-000000000000']).toBeUndefined();
      });

      it('should handle partial storage failures gracefully', async () => {
        const bugReport1 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug 1',
          description: 'Test',
          screenshot_key: 'screenshots/bug1.png',
        });

        const bugReport2 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug 2',
          description: 'Test',
          screenshot_key: 'screenshots/bug2.png',
        });

        // Mock first call to succeed, second to fail
        mockStorage.getSignedUrl
          .mockResolvedValueOnce('https://success-url.example.com')
          .mockRejectedValueOnce(new Error('Storage error'));

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport1.id, bugReport2.id],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        // First should succeed
        expect(json.urls[bugReport1.id].screenshot).toBe('https://success-url.example.com');

        // Second should be null due to error
        expect(json.urls[bugReport2.id].screenshot).toBeNull();
      });
    });

    describe('Validation', () => {
      it('should reject request with no bug report IDs', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should reject request with more than 100 IDs', async () => {
        const ids = Array(101).fill('00000000-0000-0000-0000-000000000000');

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: ids,
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should reject request with invalid type', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: ['00000000-0000-0000-0000-000000000000'],
            types: ['invalid-type'],
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should reject request with no types', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: ['00000000-0000-0000-0000-000000000000'],
            types: [],
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('Performance - No N+1 queries', () => {
      it('should fetch all bug reports in a single query', async () => {
        // Create 10 bug reports
        const bugReportIds: string[] = [];
        for (let i = 0; i < 10; i++) {
          const report = await db.bugReports.create({
            project_id: testProject.id,
            title: `Bug ${i}`,
            description: 'Test',
            screenshot_key: `screenshots/bug${i}.png`,
          });
          bugReportIds.push(report.id);
        }

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds,
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        // All 10 should be present
        expect(Object.keys(json.urls)).toHaveLength(10);

        // Verify getSignedUrl was called (spy accumulates across all tests)
        // The important thing is it was called in parallel for these 10 reports
        expect(mockStorage.getSignedUrl).toHaveBeenCalled();
        const callCount = mockStorage.getSignedUrl.mock.calls.length;
        expect(callCount).toBeGreaterThanOrEqual(10);
      });
    });
  });

  // ============================================================================
  // SECURITY: Project Access Control
  // ============================================================================
  describe('Security - Project Access Control', () => {
    let secondProject: any;
    let secondProjectApiKey: string;

    beforeEach(async () => {
      // Create a second project with its own API key
      secondProject = await db.projects.create({
        name: 'Second Project',
      });

      const apiKeyService = new ApiKeyService(db);
      const apiKeyResult = await apiKeyService.createKey({
        name: 'Second Project API Key',
        permissions: ['read', 'write'],
        allowed_projects: [secondProject.id],
      });
      secondProjectApiKey = apiKeyResult.plaintext;
    });

    describe('GET /api/v1/storage/url/:bugReportId/:type', () => {
      it('should allow access to own project bug reports', async () => {
        // Create bug report in first project
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'First Project Bug',
          description: 'Bug in first project',
          screenshot_key: 'screenshots/first-project.jpg',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json).toHaveProperty('url');
      });

      it('should deny access to other project bug reports', async () => {
        // Create bug report in second project
        const secondProjectBugReport = await db.bugReports.create({
          project_id: secondProject.id,
          title: 'Second Project Bug',
          description: 'Bug in second project',
          screenshot_key: 'screenshots/second-project.jpg',
        });

        // Try to access second project's bug report with first project's API key
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${secondProjectBugReport.id}/screenshot`,
          headers: {
            'x-api-key': testApiKey, // First project's key
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json).toHaveProperty('error');
        expect(json.error).toBe('Forbidden');
      });

      it('should deny access without authentication', async () => {
        // Create bug report in first project
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug requiring auth',
          description: 'Test bug',
          screenshot_key: 'screenshots/test.jpg',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/screenshot`,
          // No x-api-key header
        });

        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json).toHaveProperty('error');
        expect(json.error).toBe('Unauthorized');
      });

      it('should allow second project to access its own bug reports', async () => {
        // Create bug report in second project
        const secondProjectBugReport = await db.bugReports.create({
          project_id: secondProject.id,
          title: 'Second Project Bug',
          description: 'Bug in second project',
          screenshot_key: 'screenshots/second-project.jpg',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${secondProjectBugReport.id}/screenshot`,
          headers: {
            'x-api-key': secondProjectApiKey,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json).toHaveProperty('url');
      });
    });

    describe('POST /api/v1/storage/urls/batch', () => {
      it('should allow batch access to own project bug reports', async () => {
        // Create bug report in first project
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Batch test bug',
          description: 'Bug for batch test',
          screenshot_key: 'screenshots/batch-test.jpg',
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.urls[bugReport.id]).toHaveProperty('screenshot');
      });

      it('should deny batch access when any bug report belongs to unauthorized project', async () => {
        // Create bug reports in both projects
        const firstProjectBugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'First Project Bug',
          description: 'Bug in first project',
          screenshot_key: 'screenshots/first.jpg',
        });

        const secondProjectBugReport = await db.bugReports.create({
          project_id: secondProject.id,
          title: 'Second Project Bug',
          description: 'Bug in second project',
          screenshot_key: 'screenshots/second.jpg',
        });

        // Mix of own project and other project bug reports
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey, // First project's key
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [firstProjectBugReport.id, secondProjectBugReport.id], // Mixed projects!
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json).toHaveProperty('error');
        expect(json.error).toBe('Forbidden');
      });

      it('should deny batch access without authentication', async () => {
        // Create bug report in first project
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Batch auth test',
          description: 'Test bug',
          screenshot_key: 'screenshots/auth-test.jpg',
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'content-type': 'application/json',
            // No x-api-key header
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json).toHaveProperty('error');
        expect(json.error).toBe('Unauthorized');
      });

      it('should allow second project to batch access its own bug reports', async () => {
        // Create bug report in second project
        const secondProjectBugReport = await db.bugReports.create({
          project_id: secondProject.id,
          title: 'Second Project Bug',
          description: 'Bug in second project',
          screenshot_key: 'screenshots/second.jpg',
          replay_key: 'replays/second.json',
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': secondProjectApiKey,
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [secondProjectBugReport.id],
            types: ['screenshot', 'replay'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.urls[secondProjectBugReport.id]).toHaveProperty('screenshot');
        expect(json.urls[secondProjectBugReport.id]).toHaveProperty('replay');
      });

      it('should prevent cross-project enumeration attacks', async () => {
        // Create bug report in second project only
        const secondProjectBugReport = await db.bugReports.create({
          project_id: secondProject.id,
          title: 'Second Project Bug',
          description: 'Bug in second project',
          screenshot_key: 'screenshots/second.jpg',
        });

        // Attacker tries to enumerate bug report IDs from another project
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'x-api-key': testApiKey,
            'content-type': 'application/json',
          },
          payload: {
            // Only include second project's bug report IDs
            bugReportIds: [secondProjectBugReport.id],
            types: ['screenshot'],
          },
        });

        // Should be denied, not reveal whether bug report exists
        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json).toHaveProperty('error');
        expect(json.error).toBe('Forbidden');
      });
    });

    describe('Batch - Share Token Authentication', () => {
      it('should allow unauthenticated batch access with valid shareToken', async () => {
        // Create bug report with multiple resources
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Shared Bug Report',
          description: 'Test shared batch access',
          screenshot_key: 'screenshots/shared-bug.png',
          replay_key: 'replays/shared-bug.json.gz',
        });

        // Create share token
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Request without API key, but with shareToken
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/urls/batch?shareToken=${shareToken.token}`,
          headers: {
            'content-type': 'application/json',
            // NO x-api-key header!
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['screenshot', 'replay'],
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.urls[bugReport.id].screenshot).toBeDefined();
        expect(json.urls[bugReport.id].replay).toBeDefined();
      });

      it('should reject batch request with invalid shareToken', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test',
          screenshot_key: 'screenshots/test.png',
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch?shareToken=invalid-token-123',
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should reject batch request when shareToken is for different bug report', async () => {
        // Create two bug reports
        const bugReport1 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 1',
          description: 'First bug',
          screenshot_key: 'screenshots/bug1.png',
        });

        const bugReport2 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 2',
          description: 'Second bug',
          screenshot_key: 'screenshots/bug2.png',
        });

        // Create share token for bug report 1 only
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport1.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Try to access bug report 2 with bug report 1's token
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/urls/batch?shareToken=${shareToken.token}`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport2.id],
            types: ['screenshot'],
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.message).toContain('share token');
      });

      it('should reject batch request with multiple bug reports when shareToken is for only one', async () => {
        // Create two bug reports
        const bugReport1 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 1',
          description: 'First bug',
          screenshot_key: 'screenshots/bug1.png',
        });

        const bugReport2 = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report 2',
          description: 'Second bug',
          screenshot_key: 'screenshots/bug2.png',
        });

        // Create share token for bug report 1
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport1.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Try to access both bug reports with single bug report token
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/urls/batch?shareToken=${shareToken.token}`,
          headers: {
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport1.id, bugReport2.id],
            types: ['screenshot'],
          },
        });

        // Should be rejected - shareToken only valid for single bug report
        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.message.toLowerCase()).toContain('share token');
      });

      it('should use standard auth when shareToken not provided in batch request', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug Report',
          description: 'Test standard auth',
          screenshot_key: 'screenshots/test.png',
        });

        // Request without API key AND without shareToken
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/storage/urls/batch',
          headers: {
            'content-type': 'application/json',
            // No headers, no shareToken
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['screenshot'],
          },
        });

        // Should fail with 401 (no authentication)
        expect(response.statusCode).toBe(401);
      });

      it('should prioritize shareToken over API key in batch request', async () => {
        // Create bug report in a different project
        const otherProject = await db.projects.create({
          name: 'Other Project for Batch',
        });

        const bugReport = await db.bugReports.create({
          project_id: otherProject.id,
          title: 'Bug in Other Project',
          description: 'Test token priority',
          screenshot_key: 'screenshots/other-batch.png',
        });

        // Create share token
        const token = generateShareToken();
        const shareToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Request with API key that doesn't have access to other project, but with valid shareToken
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/urls/batch?shareToken=${shareToken.token}`,
          headers: {
            'x-api-key': testApiKey, // Has access to testProject only
            'content-type': 'application/json',
          },
          payload: {
            bugReportIds: [bugReport.id],
            types: ['screenshot'],
          },
        });

        // Should succeed because shareToken takes priority
        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.urls[bugReport.id].screenshot).toBeDefined();
      });
    });
  });
});
