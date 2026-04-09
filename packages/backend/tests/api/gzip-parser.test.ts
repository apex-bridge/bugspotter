/**
 * Gzip Content-Type Parser Tests
 * Tests gzipped payload handling for bug report submissions
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gzipSync } from 'zlib';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Project } from '../../src/db/types.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Gzip Content-Type Parser', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let apiKey: string;
  let testProject: Project;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();

    // Create test project, user, and API key
    testProject = await db.projects.create({
      name: 'Gzip Test Project',
    });

    const testUser = await db.users.create({
      email: 'gzip-test@example.com',
      password_hash: 'hash',
      role: 'admin',
    });

    const { ApiKeyService } = await import('../../src/services/api-key/index.js');
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Gzip Test Key',
      type: 'development',
      permission_scope: 'full',
      permissions: ['bugs:read', 'bugs:write'],
      created_by: testUser.id,
      allowed_projects: [testProject.id],
    });
    apiKey = apiKeyResult.plaintext;
  });

  afterAll(async () => {
    // Clean up
    if (testProject) {
      await db.projects.delete(testProject.id);
    }
    await server.close();
    await db.close();
  });

  describe('application/gzip Content-Type', () => {
    it('should accept and decompress gzipped bug report payload', async () => {
      const payload = {
        title: 'Gzip Test Bug',
        description: 'Testing gzipped payload',
        priority: 'high',
        report: {
          console: [{ level: 'info', message: 'Test log', timestamp: Date.now() }],
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      // Compress the payload
      const jsonString = JSON.stringify(payload);
      const compressed = gzipSync(jsonString);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Encoding': 'gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe('Gzip Test Bug');
      expect(json.data.description).toBe('Testing gzipped payload');
    });

    it('should accept application/x-gzip content type', async () => {
      const payload = {
        title: 'X-Gzip Test Bug',
        description: 'Testing x-gzip content type',
        priority: 'medium',
        report: {
          console: [],
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const compressed = gzipSync(JSON.stringify(payload));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/x-gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe('X-Gzip Test Bug');
    });

    it('should handle large compressed payloads', async () => {
      // Create a large payload with many console logs
      const largeLogs = Array.from({ length: 1000 }, (_, i) => ({
        level: 'info',
        message: `Log entry ${i} with some additional text to make it larger`,
        timestamp: Date.now() + i,
      }));

      const payload = {
        title: 'Large Gzip Payload',
        description: 'Testing large compressed data',
        priority: 'low',
        report: {
          console: largeLogs,
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const jsonString = JSON.stringify(payload);
      const compressed = gzipSync(jsonString);

      // Verify compression is effective
      expect(compressed.length).toBeLessThan(jsonString.length);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      // Verify the large gzipped payload was properly decompressed
      // The key test here is that status=201 was returned, meaning
      // the gzip decompression succeeded and the data was processed
      expect(json.data).toBeDefined();
      expect(json.data.title).toBe('Large Gzip Payload');
      expect(json.data.description).toBe('Testing large compressed data');

      // Verify compression was effective
      expect(compressed.length).toBeLessThan(jsonString.length / 2);
    });

    it('should return error for invalid gzip data', async () => {
      // Send invalid gzip data
      const invalidGzip = Buffer.from('not a valid gzip', 'utf-8');

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: invalidGzip,
      });

      // Fastify content-type parser errors return 500
      expect(response.statusCode).toBe(500);
    });

    it('should return error for corrupted gzip data', async () => {
      const payload = { title: 'Test' };
      const compressed = gzipSync(JSON.stringify(payload));

      // Corrupt the gzip data by modifying bytes
      const corrupted = Buffer.from(compressed);
      corrupted[10] = 0xff; // Corrupt a byte

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: corrupted,
      });

      // Fastify content-type parser errors return 500
      expect(response.statusCode).toBe(500);
    });

    it('should handle gzipped JSON with special characters', async () => {
      const payload = {
        title: 'Test with émojis 🎉 and spëcial çharacters',
        description: 'Unicode test: 日本語, 한글, العربية',
        priority: 'medium',
        report: {
          console: [
            {
              level: 'info',
              message: 'Special chars: ñ, ü, ø, æ, ß',
              timestamp: Date.now(),
            },
          ],
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const compressed = gzipSync(JSON.stringify(payload));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe('Test with émojis 🎉 and spëcial çharacters');
      expect(json.data.description).toBe('Unicode test: 日本語, 한글, العربية');
    });

    it('should still accept regular JSON payloads', async () => {
      const payload = {
        title: 'Regular JSON Bug',
        description: 'Testing uncompressed payload',
        priority: 'high',
        report: {
          console: [],
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        payload: payload,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe('Regular JSON Bug');
    });
  });

  describe('Compression Efficiency', () => {
    it('should show compression benefits for repetitive data', () => {
      const repetitivePayload = {
        title: 'Compression Test',
        report: {
          console: Array.from({ length: 100 }, () => ({
            level: 'info',
            message: 'This is a repetitive message that should compress well',
            timestamp: Date.now(),
          })),
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const jsonString = JSON.stringify(repetitivePayload);
      const compressed = gzipSync(jsonString);

      const originalSize = Buffer.from(jsonString).length;
      const compressedSize = compressed.length;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      // Repetitive data should compress by at least 50%
      expect(compressedSize).toBeLessThan(originalSize * 0.5);
      expect(parseFloat(compressionRatio)).toBeGreaterThan(50);
    });
  });

  describe('Presigned URL Flow', () => {
    it('should handle gzipped payload with hasScreenshot flag', async () => {
      const payload = {
        title: 'Bug with Screenshot',
        description: 'Testing presigned URL flow for screenshot',
        priority: 'high',
        hasScreenshot: true,
        report: {
          console: [{ level: 'error', message: 'Screenshot test', timestamp: Date.now() }],
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const compressed = gzipSync(JSON.stringify(payload));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      // Storage key should be set when presigned URL is generated
      expect(json.data.screenshot_key).not.toBe(null);
      expect(json.data.upload_status).toBe('pending');
      // Verify presigned URL is returned
      expect(json.data.presignedUrls).toBeDefined();
      expect(json.data.presignedUrls.screenshot).toBeDefined();
      // Verify storage key matches the one in presigned URL response
      expect(json.data.presignedUrls.screenshot.storageKey).toBe(json.data.screenshot_key);
    });

    it('should handle gzipped payload with hasReplay flag', async () => {
      const payload = {
        title: 'Bug with Replay',
        description: 'Testing presigned URL flow for session replay',
        priority: 'medium',
        hasReplay: true,
        report: {
          console: [],
          network: [],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const compressed = gzipSync(JSON.stringify(payload));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      // Storage key should be set when presigned URL is generated
      expect(json.data.replay_key).not.toBe(null);
      expect(json.data.replay_upload_status).toBe('pending');
      // Verify presigned URL is returned
      expect(json.data.presignedUrls).toBeDefined();
      expect(json.data.presignedUrls.replay).toBeDefined();
      // Verify storage key matches the one in presigned URL response
      expect(json.data.presignedUrls.replay.storageKey).toBe(json.data.replay_key);
    });

    it('should handle gzipped payload with both hasScreenshot and hasReplay flags', async () => {
      const payload = {
        title: 'Bug with Screenshot and Replay',
        description: 'Testing presigned URL flow for both uploads',
        priority: 'critical',
        hasScreenshot: true,
        hasReplay: true,
        report: {
          console: [{ level: 'error', message: 'Critical bug', timestamp: Date.now() }],
          network: [
            {
              url: 'https://api.example.com/test',
              method: 'POST',
              status: 500,
              duration: 1234,
              timestamp: Date.now(),
            },
          ],
          metadata: {
            userAgent: 'test-agent',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.example.com',
            timestamp: Date.now(),
          },
        },
      };

      const compressed = gzipSync(JSON.stringify(payload));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'Content-Type': 'application/gzip',
          'X-API-Key': apiKey,
        },
        payload: compressed,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      // Storage keys should be set when presigned URLs are generated
      expect(json.data.screenshot_key).not.toBe(null);
      expect(json.data.upload_status).toBe('pending');
      expect(json.data.replay_key).not.toBe(null);
      expect(json.data.replay_upload_status).toBe('pending');
      // Verify both presigned URLs are returned
      expect(json.data.presignedUrls).toBeDefined();
      expect(json.data.presignedUrls.screenshot).toBeDefined();
      expect(json.data.presignedUrls.replay).toBeDefined();
      // Verify storage keys match the ones in presigned URL response
      expect(json.data.presignedUrls.screenshot.storageKey).toBe(json.data.screenshot_key);
      expect(json.data.presignedUrls.replay.storageKey).toBe(json.data.replay_key);
    });
  });
});
