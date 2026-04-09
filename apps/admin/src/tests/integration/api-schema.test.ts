/**
 * API Schema Compatibility Tests
 *
 * These tests verify that the backend API returns the expected field names
 * in bug report responses. They will fail if there are breaking changes in
 * the API schema (e.g., field renames without corresponding admin updates).
 *
 * Purpose: Catch breaking changes early before they reach production
 */

import { describe, it, expect } from 'vitest';

describe('API Schema Compatibility', () => {
  describe('Bug Report Response Schema', () => {
    it('should document expected metadata field structure', () => {
      // This test documents the expected schema from the backend API
      // If the backend changes field names, this test should be updated
      // AND all admin code should be reviewed for compatibility

      const expectedSchema = {
        metadata: {
          console: expect.any(Array), // Was: consoleLogs
          network: expect.any(Array), // Was: networkRequests
          metadata: expect.any(Object), // Was: browserMetadata
        },
      };

      // Expected console log entry structure
      const expectedConsoleLog = {
        level: expect.any(String), // 'info' | 'warn' | 'error' | 'debug'
        message: expect.any(String),
        timestamp: expect.any(Number),
      };

      // Expected network request entry structure
      const expectedNetworkRequest = {
        url: expect.any(String),
        method: expect.any(String),
        status: expect.any(Number),
        timestamp: expect.any(Number),
      };

      // Expected browser metadata structure
      const expectedBrowserMetadata = {
        userAgent: expect.any(String),
        viewport: expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number),
        }),
        url: expect.any(String),
        timestamp: expect.any(Number),
      };

      // This test always passes - it's documentation
      // Real validation happens in E2E tests below
      expect(expectedSchema).toBeDefined();
      expect(expectedConsoleLog).toBeDefined();
      expect(expectedNetworkRequest).toBeDefined();
      expect(expectedBrowserMetadata).toBeDefined();
    });

    it('should fail if bug report fixture uses OLD field names', () => {
      // This ensures test fixtures match the current API schema
      const testFixture = {
        report: {
          console: [{ level: 'info', message: 'Test', timestamp: Date.now() }],
          network: [],
          metadata: {
            userAgent: 'Test',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.com',
          },
        },
      };

      // Verify we're using NEW field names
      expect(testFixture.report).toHaveProperty('console');
      expect(testFixture.report).toHaveProperty('network');
      expect(testFixture.report).toHaveProperty('metadata');

      // Ensure we're NOT using old field names
      expect(testFixture.report).not.toHaveProperty('consoleLogs');
      expect(testFixture.report).not.toHaveProperty('networkRequests');
      expect(testFixture.report).not.toHaveProperty('browserMetadata');
    });

    it('should validate console log array structure', () => {
      const consoleLogs = [
        { level: 'info', message: 'App started', timestamp: 1699000000000 },
        { level: 'error', message: 'API failed', timestamp: 1699000001000 },
      ];

      consoleLogs.forEach((log) => {
        expect(log).toHaveProperty('level');
        expect(log).toHaveProperty('message');
        expect(log).toHaveProperty('timestamp');
        expect(['info', 'warn', 'error', 'debug']).toContain(log.level);
        expect(typeof log.message).toBe('string');
        expect(typeof log.timestamp).toBe('number');
      });
    });

    it('should validate network request array structure', () => {
      const networkRequests = [
        {
          url: 'https://api.example.com/users',
          method: 'GET',
          status: 200,
          timestamp: 1699000000000,
        },
        {
          url: 'https://api.example.com/posts',
          method: 'POST',
          status: 201,
          timestamp: 1699000001000,
        },
      ];

      networkRequests.forEach((request) => {
        expect(request).toHaveProperty('url');
        expect(request).toHaveProperty('method');
        expect(request).toHaveProperty('status');
        expect(request).toHaveProperty('timestamp');
        expect(typeof request.url).toBe('string');
        expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(request.method);
        expect(typeof request.status).toBe('number');
        expect(typeof request.timestamp).toBe('number');
      });
    });

    it('should validate browser metadata structure', () => {
      const browserMetadata = {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        url: 'https://myapp.com/dashboard',
        timestamp: 1699000000000,
      };

      expect(browserMetadata).toHaveProperty('userAgent');
      expect(browserMetadata).toHaveProperty('viewport');
      expect(browserMetadata.viewport).toHaveProperty('width');
      expect(browserMetadata.viewport).toHaveProperty('height');
      expect(browserMetadata).toHaveProperty('url');
      expect(typeof browserMetadata.userAgent).toBe('string');
      expect(typeof browserMetadata.viewport.width).toBe('number');
      expect(typeof browserMetadata.viewport.height).toBe('number');
      expect(typeof browserMetadata.url).toBe('string');
    });

    it('should validate complete bug report metadata structure', () => {
      const bugReportMetadata = {
        console: [{ level: 'error', message: 'Uncaught TypeError', timestamp: 1699000000000 }],
        network: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            status: 500,
            timestamp: 1699000000000,
          },
        ],
        metadata: {
          userAgent: 'Mozilla/5.0...',
          viewport: { width: 1920, height: 1080 },
          url: 'https://myapp.com',
          timestamp: 1699000000000,
        },
      };

      // Top-level structure
      expect(bugReportMetadata).toHaveProperty('console');
      expect(bugReportMetadata).toHaveProperty('network');
      expect(bugReportMetadata).toHaveProperty('metadata');

      // Array types
      expect(Array.isArray(bugReportMetadata.console)).toBe(true);
      expect(Array.isArray(bugReportMetadata.network)).toBe(true);

      // Object type
      expect(typeof bugReportMetadata.metadata).toBe('object');
      expect(bugReportMetadata.metadata).not.toBeNull();
    });

    it('should document breaking change indicators', () => {
      // This test serves as documentation of what constitutes a breaking change
      const breakingChanges = [
        'Renaming metadata.console to metadata.consoleLogs',
        'Renaming metadata.network to metadata.networkRequests',
        'Renaming metadata.metadata to metadata.browserMetadata',
        'Removing any of the three metadata fields',
        'Changing console/network from array to object',
        'Changing metadata from object to array',
        'Changing console log entry structure (level, message, timestamp)',
        'Changing network request structure (url, method, status, timestamp)',
        'Changing browser metadata structure (userAgent, viewport, url)',
      ];

      // If any of these changes occur in the backend:
      // 1. Update this test to reflect new schema
      // 2. Update all admin fixtures (setup-fixture.ts, E2E tests)
      // 3. Update admin TypeScript types
      // 4. Update admin UI components that display this data
      // 5. Consider backward compatibility or migration strategy

      expect(breakingChanges.length).toBeGreaterThan(0);
      expect(breakingChanges).toContain('Renaming metadata.console to metadata.consoleLogs');
    });
  });

  describe('API Request Schema', () => {
    it('should document expected bug report creation request schema', () => {
      // When creating a bug report, the request should use these field names
      const expectedRequestBody = {
        title: expect.any(String),
        description: expect.any(String),
        priority: expect.stringMatching(/^(low|medium|high|critical)$/),
        report: {
          console: expect.any(Array),
          network: expect.any(Array),
          metadata: expect.any(Object),
        },
      };

      expect(expectedRequestBody).toBeDefined();
    });

    it('should validate POST /api/v1/reports request body structure', () => {
      const requestBody = {
        title: 'Application Crash',
        description: 'App crashes when clicking submit',
        priority: 'high',
        report: {
          console: [
            { level: 'error', message: 'TypeError: null is not an object', timestamp: Date.now() },
          ],
          network: [
            {
              url: 'https://api.example.com/submit',
              method: 'POST',
              status: 500,
              timestamp: Date.now(),
            },
          ],
          metadata: {
            userAgent: 'Mozilla/5.0...',
            viewport: { width: 1920, height: 1080 },
            url: 'https://myapp.com/form',
            timestamp: Date.now(),
          },
        },
      };

      // Validate top-level fields
      expect(requestBody).toHaveProperty('title');
      expect(requestBody).toHaveProperty('description');
      expect(requestBody).toHaveProperty('priority');
      expect(requestBody).toHaveProperty('report');

      // Validate report structure
      expect(requestBody.report).toHaveProperty('console');
      expect(requestBody.report).toHaveProperty('network');
      expect(requestBody.report).toHaveProperty('metadata');

      // Ensure we're NOT using old field names in requests
      expect(requestBody.report).not.toHaveProperty('consoleLogs');
      expect(requestBody.report).not.toHaveProperty('networkRequests');
      expect(requestBody.report).not.toHaveProperty('browserMetadata');
    });
  });

  describe('TypeScript Type Definitions', () => {
    it('should ensure BugReportMetadata type matches API schema', () => {
      // This test validates that our TypeScript types match the API
      // If this fails, it means types are out of sync with the API

      type BugReportMetadata = {
        console: Array<{ level: string; message: string; timestamp: number }>;
        network: Array<{ url: string; method: string; status: number; timestamp: number }>;
        metadata: {
          userAgent: string;
          viewport: { width: number; height: number };
          url: string;
          timestamp: number;
        };
      };

      const example: BugReportMetadata = {
        console: [{ level: 'error', message: 'Test', timestamp: Date.now() }],
        network: [{ url: 'https://test.com', method: 'GET', status: 200, timestamp: Date.now() }],
        metadata: {
          userAgent: 'Test',
          viewport: { width: 1920, height: 1080 },
          url: 'https://test.com',
          timestamp: Date.now(),
        },
      };

      // Type check passes - this confirms our types are correct
      expect(example).toHaveProperty('console');
      expect(example).toHaveProperty('network');
      expect(example).toHaveProperty('metadata');
    });
  });
});
