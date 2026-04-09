/**
 * Unit tests for NetworkLogsFormatter service
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NetworkLogsFormatter,
  NetworkLogEntry,
} from '../../src/services/integrations/network-logs-formatter';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Factory function to create test network log entries
 */
function createNetworkLog(overrides: Partial<NetworkLogEntry> = {}): NetworkLogEntry {
  return {
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    duration: 150,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('NetworkLogsFormatter', () => {
  let formatter: NetworkLogsFormatter;

  beforeEach(() => {
    formatter = new NetworkLogsFormatter();
  });

  // ==========================================================================
  // FILTERING
  // ==========================================================================

  describe('Filtering', () => {
    it('should include all requests by default', () => {
      const logs = [
        createNetworkLog({ status: 200 }),
        createNetworkLog({ status: 404 }),
        createNetworkLog({ status: 500 }),
      ];

      const result = formatter.format(logs);

      expect(result.entryCount).toBe(3);
      expect(result.filteredCount).toBe(0);
    });

    it('should filter to failed requests only when failedOnly is true', () => {
      const logs = [
        createNetworkLog({ status: 200 }),
        createNetworkLog({ status: 201 }),
        createNetworkLog({ status: 404 }),
        createNetworkLog({ status: 500 }),
      ];

      const result = formatter.format(logs, { failedOnly: true });

      expect(result.entryCount).toBe(2);
      expect(result.filteredCount).toBe(2); // 2 successful requests filtered out
      expect(result.failedCount).toBe(2);
    });

    it('should count 4xx as failed requests', () => {
      const logs = [
        createNetworkLog({ status: 400 }),
        createNetworkLog({ status: 401 }),
        createNetworkLog({ status: 404 }),
      ];

      const result = formatter.format(logs, { failedOnly: true });

      expect(result.entryCount).toBe(3);
      expect(result.filteredCount).toBe(0);
      expect(result.failedCount).toBe(3);
    });

    it('should count 5xx as failed requests', () => {
      const logs = [
        createNetworkLog({ status: 500 }),
        createNetworkLog({ status: 502 }),
        createNetworkLog({ status: 503 }),
      ];

      const result = formatter.format(logs, { failedOnly: true });

      expect(result.entryCount).toBe(3);
      expect(result.filteredCount).toBe(0);
      expect(result.failedCount).toBe(3);
    });

    it('should not count 3xx as failed requests', () => {
      const logs = [
        createNetworkLog({ status: 301 }),
        createNetworkLog({ status: 302 }),
        createNetworkLog({ status: 404 }),
      ];

      const result = formatter.format(logs, { failedOnly: true });

      expect(result.entryCount).toBe(1); // Only 404
      expect(result.filteredCount).toBe(2); // 301, 302 filtered out
      expect(result.failedCount).toBe(1);
    });

    it('should handle all successful requests with failedOnly', () => {
      const logs = [
        createNetworkLog({ status: 200 }),
        createNetworkLog({ status: 201 }),
        createNetworkLog({ status: 204 }),
      ];

      const result = formatter.format(logs, { failedOnly: true });

      expect(result.entryCount).toBe(0);
      expect(result.filteredCount).toBe(3);
      expect(result.failedCount).toBe(0);
    });
  });

  // ==========================================================================
  // MAX ENTRIES
  // ==========================================================================

  describe('Max Entries', () => {
    it('should limit to maxEntries', () => {
      const logs = Array.from({ length: 100 }, (_, i) =>
        createNetworkLog({ timestamp: Date.now() + i * 1000 })
      );

      const result = formatter.format(logs, { maxEntries: 10 });

      expect(result.entryCount).toBe(10);
      expect(result.filteredCount).toBe(0);
    });

    it('should take most recent entries when limiting', () => {
      const logs = [
        createNetworkLog({ url: '/old', timestamp: 1000 }),
        createNetworkLog({ url: '/recent', timestamp: 3000 }),
        createNetworkLog({ url: '/newest', timestamp: 5000 }),
      ];

      const result = formatter.format(logs, { maxEntries: 2, format: 'json' });

      const parsed = JSON.parse(result.content);
      expect(parsed.entries).toHaveLength(2);
      // Entries limited to 2 most recent (3000, 5000), then sorted chronologically
      expect(parsed.entries[0].url).toBe('/recent');
      expect(parsed.entries[1].url).toBe('/newest');
    });

    it('should handle maxEntries larger than log count', () => {
      const logs = [createNetworkLog(), createNetworkLog(), createNetworkLog()];

      const result = formatter.format(logs, { maxEntries: 100 });

      expect(result.entryCount).toBe(3);
      expect(result.filteredCount).toBe(0);
    });

    it('should default to 50 entries', () => {
      const logs = Array.from({ length: 100 }, () => createNetworkLog());

      const result = formatter.format(logs);

      expect(result.entryCount).toBe(50);
    });

    it('should apply maxEntries after filtering', () => {
      const logs = Array.from({ length: 100 }, (_, i) =>
        createNetworkLog({
          status: i < 60 ? 200 : 500,
          timestamp: Date.now() + i * 1000,
        })
      );

      const result = formatter.format(logs, {
        failedOnly: true,
        maxEntries: 10,
      });

      expect(result.entryCount).toBe(10);
      expect(result.filteredCount).toBe(60); // 60 successful requests filtered
      expect(result.failedCount).toBe(10);
    });
  });

  // ==========================================================================
  // TEXT FORMAT
  // ==========================================================================

  describe('Text Format', () => {
    it('should format as text by default', () => {
      const logs = [createNetworkLog()];

      const result = formatter.format(logs);

      expect(result.mimeType).toBe('text/plain');
      expect(result.filename).toBe('network-logs.txt');
      expect(result.content).toContain('GET');
      expect(result.content).toContain('https://api.example.com/users');
    });

    it('should include timestamp in text format', () => {
      const timestamp = new Date('2024-01-15T10:30:45.000Z').getTime();
      const logs = [createNetworkLog({ timestamp })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('2024-01-15 10:30:45');
    });

    it('should include method and status in text format', () => {
      const logs = [createNetworkLog({ method: 'POST', status: 201 })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('POST');
      expect(result.content).toContain('201');
    });

    it('should include duration in text format', () => {
      const logs = [createNetworkLog({ duration: 1250 })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('1250ms');
    });

    it('should include request headers when present', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('Request Headers:');
      expect(result.content).toContain('Content-Type: application/json');
      expect(result.content).toContain('Accept: application/json');
    });

    it('should include response headers when present', () => {
      const logs = [
        createNetworkLog({
          responseHeaders: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('Response Headers:');
      expect(result.content).toContain('Content-Type: application/json');
      expect(result.content).toContain('Cache-Control: no-cache');
    });

    it('should include request body when includeBodies is true', () => {
      const logs = [
        createNetworkLog({
          requestBody: '{"username":"john","email":"john@example.com"}',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('Request Body:');
      expect(result.content).toContain('username');
      expect(result.content).toContain('[REDACTED-EMAIL]');
      expect(result.content).not.toContain('john@example.com');
    });

    it('should include response body when includeBodies is true', () => {
      const logs = [
        createNetworkLog({
          responseBody: '{"id":123,"name":"Test User"}',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('Response Body:');
      expect(result.content).toContain('"id":123');
      expect(result.content).toContain('Test User');
    });

    it('should exclude bodies when includeBodies is false', () => {
      const logs = [
        createNetworkLog({
          requestBody: '{"password":"secret123"}',
          responseBody: '{"token":"abc123"}',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: false,
      });

      expect(result.content).not.toContain('Request Body:');
      expect(result.content).not.toContain('Response Body:');
      expect(result.content).not.toContain('secret123');
      expect(result.content).not.toContain('abc123');
    });

    it('should include error message when present', () => {
      const logs = [
        createNetworkLog({
          status: 500,
          error: 'Network timeout after 30s',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('Error: Network timeout after 30s');
    });

    it('should format multiple entries with separation', () => {
      const logs = [createNetworkLog({ url: '/users' }), createNetworkLog({ url: '/posts' })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('/users');
      expect(result.content).toContain('/posts');
      // Should have empty lines between entries
      expect(result.content.split('\n\n').length).toBeGreaterThan(1);
    });
  });

  // ==========================================================================
  // MARKDOWN FORMAT
  // ==========================================================================

  describe('Markdown Format', () => {
    it('should format as markdown', () => {
      const logs = [createNetworkLog()];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.mimeType).toBe('text/markdown');
      expect(result.filename).toBe('network-logs.md');
      expect(result.content).toContain('## Network Logs');
    });

    it('should include request count in header', () => {
      const logs = [createNetworkLog(), createNetworkLog(), createNetworkLog()];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).toContain('## Network Logs (3 requests)');
    });

    it('should show warning for failed requests', () => {
      const logs = [
        createNetworkLog({ status: 200 }),
        createNetworkLog({ status: 404 }),
        createNetworkLog({ status: 500 }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).toContain('⚠️ **2 failed requests**');
    });

    it('should use correct emoji for status codes', () => {
      const logs = [
        createNetworkLog({ status: 200, url: '/success' }),
        createNetworkLog({ status: 301, url: '/redirect' }),
        createNetworkLog({ status: 404, url: '/not-found' }),
        createNetworkLog({ status: 500, url: '/error' }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).toContain('### ✓'); // 200
      expect(result.content).toContain('### ↗'); // 301
      expect(result.content).toContain('### ✗'); // 404
      expect(result.content).toContain('### ⚠'); // 500
    });

    it('should format headers in code blocks', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: { 'Content-Type': 'application/json' },
        }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).toContain('**Request Headers:**');
      expect(result.content).toContain('```');
      expect(result.content).toContain('Content-Type: application/json');
    });

    it('should format bodies in code blocks', () => {
      const logs = [
        createNetworkLog({
          requestBody: '{"test":"data"}',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'markdown',
        includeBodies: true,
      });

      expect(result.content).toContain('**Request Body:**');
      expect(result.content).toContain('```');
      expect(result.content).toContain('{"test":"data"}');
    });

    it('should separate entries with horizontal rules', () => {
      const logs = [createNetworkLog(), createNetworkLog()];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).toContain('---');
    });
  });

  // ==========================================================================
  // JSON FORMAT
  // ==========================================================================

  describe('JSON Format', () => {
    it('should format as JSON', () => {
      const logs = [createNetworkLog()];

      const result = formatter.format(logs, { format: 'json' });

      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toBe('network-logs.json');
      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    it('should include entries array', () => {
      const logs = [
        createNetworkLog({ url: '/test1', timestamp: 1000 }),
        createNetworkLog({ url: '/test2', timestamp: 2000 }),
      ];

      const result = formatter.format(logs, { format: 'json' });
      const parsed = JSON.parse(result.content);

      expect(parsed.entries).toBeDefined();
      expect(parsed.entries).toHaveLength(2);
      // JSON format now uses chronological order (oldest first)
      expect(parsed.entries[0].url).toBe('/test1');
      expect(parsed.entries[1].url).toBe('/test2');
    });

    it('should include summary with counts', () => {
      const logs = [
        createNetworkLog({ status: 200 }),
        createNetworkLog({ status: 201 }),
        createNetworkLog({ status: 404 }),
        createNetworkLog({ status: 500 }),
      ];

      const result = formatter.format(logs, { format: 'json' });
      const parsed = JSON.parse(result.content);

      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.total).toBe(4);
      expect(parsed.summary.success).toBe(2);
      expect(parsed.summary.failed).toBe(2);
    });

    it('should include metadata with timestamp', () => {
      const logs = [createNetworkLog()];

      const result = formatter.format(logs, { format: 'json' });
      const parsed = JSON.parse(result.content);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.generatedAt).toBeDefined();
      expect(new Date(parsed.metadata.generatedAt).getTime()).toBeGreaterThan(0);
    });

    it('should include datetime in readable format', () => {
      const timestamp = new Date('2024-01-15T10:30:45.000Z').getTime();
      const logs = [createNetworkLog({ timestamp })];

      const result = formatter.format(logs, { format: 'json' });
      const parsed = JSON.parse(result.content);

      expect(parsed.entries[0].datetime).toBe('2024-01-15 10:30:45');
    });

    it('should conditionally include bodies based on includeBodies', () => {
      const logs = [
        createNetworkLog({
          requestBody: '{"test":"data"}',
          responseBody: '{"result":"ok"}',
        }),
      ];

      const withBodies = formatter.format(logs, {
        format: 'json',
        includeBodies: true,
      });
      const withoutBodies = formatter.format(logs, {
        format: 'json',
        includeBodies: false,
      });

      const parsedWith = JSON.parse(withBodies.content);
      const parsedWithout = JSON.parse(withoutBodies.content);

      expect(parsedWith.entries[0].requestBody).toBe('{"test":"data"}');
      expect(parsedWith.entries[0].responseBody).toBe('{"result":"ok"}');
      expect(parsedWithout.entries[0].requestBody).toBeUndefined();
      expect(parsedWithout.entries[0].responseBody).toBeUndefined();
    });
  });

  // ==========================================================================
  // HAR FORMAT
  // ==========================================================================

  describe('HAR Format', () => {
    it('should format as HAR', () => {
      const logs = [createNetworkLog()];

      const result = formatter.format(logs, { format: 'har' });

      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toBe('network-logs.har');
      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    it('should follow HAR 1.2 spec structure', () => {
      const logs = [createNetworkLog()];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);

      expect(parsed.log).toBeDefined();
      expect(parsed.log.version).toBe('1.2');
      expect(parsed.log.creator).toBeDefined();
      expect(parsed.log.creator.name).toBe('BugSpotter');
      expect(parsed.log.entries).toBeDefined();
      expect(Array.isArray(parsed.log.entries)).toBe(true);
    });

    it('should include request details in HAR format', () => {
      const logs = [
        createNetworkLog({
          method: 'POST',
          url: 'https://api.example.com/users',
          requestHeaders: { 'Content-Type': 'application/json' },
          requestBody: '{"name":"test"}',
        }),
      ];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);
      const entry = parsed.log.entries[0];

      expect(entry.request.method).toBe('POST');
      expect(entry.request.url).toBe('https://api.example.com/users');
      expect(entry.request.headers).toHaveLength(1);
      expect(entry.request.headers[0].name).toBe('Content-Type');
      expect(entry.request.postData.text).toBe('{"name":"test"}');
    });

    it('should include response details in HAR format', () => {
      const logs = [
        createNetworkLog({
          status: 201,
          responseHeaders: { 'Content-Type': 'application/json' },
          responseBody: '{"id":123}',
        }),
      ];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);
      const entry = parsed.log.entries[0];

      expect(entry.response.status).toBe(201);
      expect(entry.response.statusText).toBe('Created');
      expect(entry.response.headers).toHaveLength(1);
      expect(entry.response.content.text).toBe('{"id":123}');
    });

    it('should include timing information in HAR format', () => {
      const logs = [createNetworkLog({ duration: 1250 })];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);
      const entry = parsed.log.entries[0];

      expect(entry.time).toBe(1250);
      expect(entry.timings.wait).toBe(1250);
    });

    it('should include error in HAR format', () => {
      const logs = [
        createNetworkLog({
          status: 500,
          error: 'Connection timeout',
        }),
      ];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);
      const entry = parsed.log.entries[0];

      expect(entry._error).toBe('Connection timeout');
    });

    it('should sort entries chronologically for HAR', () => {
      const logs = [
        createNetworkLog({ url: '/third', timestamp: 3000 }),
        createNetworkLog({ url: '/first', timestamp: 1000 }),
        createNetworkLog({ url: '/second', timestamp: 2000 }),
      ];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);

      expect(parsed.log.entries[0].request.url).toBe('/first');
      expect(parsed.log.entries[1].request.url).toBe('/second');
      expect(parsed.log.entries[2].request.url).toBe('/third');
    });
  });

  // ==========================================================================
  // REDACTION
  // ==========================================================================

  describe('Redaction', () => {
    it('should redact Authorization header by default', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {
            Authorization: 'Bearer abc123def456ghi789jklmnopqrstuvwxyz',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('Authorization: [REDACTED]');
      expect(result.content).not.toContain('abc123def456');
    });

    it('should redact Cookie header by default', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {
            Cookie: 'session=abc123; token=def456',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('Cookie: [REDACTED]');
      expect(result.content).not.toContain('session=abc123');
    });

    it('should redact Set-Cookie header by default', () => {
      const logs = [
        createNetworkLog({
          responseHeaders: {
            'Set-Cookie': 'session=xyz789; HttpOnly; Secure',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('Set-Cookie: [REDACTED]');
      expect(result.content).not.toContain('xyz789');
    });

    it('should redact X-API-Key header by default', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {
            'X-API-Key': 'sk_live_TESTKEY_0000000000000000',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('X-API-Key: [REDACTED]');
      expect(result.content).not.toContain('sk_live_');
    });

    it('should redact custom headers when specified', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {
            'X-Custom-Token': 'secret123',
            'Content-Type': 'application/json',
          },
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        redactHeaders: ['X-Custom-Token'],
      });

      expect(result.content).toContain('X-Custom-Token: [REDACTED]');
      expect(result.content).toContain('Content-Type: application/json');
      expect(result.content).not.toContain('secret123');
    });

    it('should redact sensitive patterns in URLs', () => {
      const logs = [
        createNetworkLog({
          url: 'https://api.example.com/users?api_key=sk_live_TESTKEY_0000000000000000',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      // Bearer pattern matches first (32+ chars), so we get 'Bearer [REDACTED]'
      expect(result.content).toContain('Bearer [REDACTED]');
      expect(result.content).not.toContain('sk_live_');
    });

    it('should redact Bearer tokens in URL', () => {
      const logs = [
        createNetworkLog({
          url: 'https://api.example.com/data?token=Bearer%20abc123def456ghi789jklmnopqrstuvwxyz',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('[REDACTED]');
      expect(result.content).not.toContain('abc123def456');
    });

    it('should redact passwords in request body', () => {
      const logs = [
        createNetworkLog({
          requestBody: '{"username":"john","password":"secret123"}',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      // Password pattern replaces with 'password=[REDACTED]'
      expect(result.content).toContain('password=[REDACTED]');
      expect(result.content).not.toContain('secret123');
    });

    it('should redact API keys in response body', () => {
      const logs = [
        createNetworkLog({
          responseBody: '{"api_key":"sk_live_TESTKEY_0000000000000000","name":"Test"}',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      // Bearer pattern matches first (32+ chars)
      expect(result.content).toContain('Bearer [REDACTED]');
      expect(result.content).not.toContain('sk_live_');
    });

    it('should redact sensitive patterns in error messages', () => {
      const logs = [
        createNetworkLog({
          status: 500,
          error:
            'Authentication failed: Bearer token abc123def456ghi789jklmnopqrstuvwxyz is invalid',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('[REDACTED]');
      expect(result.content).not.toContain('abc123def456');
    });

    it('should redact multiple patterns in same field', () => {
      const logs = [
        createNetworkLog({
          url: 'https://api.example.com/users?api_key=sk_live_TESTKEY_0000000000000000&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('[REDACTED]');
      expect(result.content).not.toContain('sk_live_');
      expect(result.content).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc');
    });

    it('should be case-insensitive for header redaction', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {
            AUTHORIZATION: 'Bearer abc123def456ghi789jklmnopqrstuvwxyz',
            cookie: 'session=xyz',
          },
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('AUTHORIZATION: [REDACTED]');
      expect(result.content).toContain('cookie: [REDACTED]');
    });
  });

  // ==========================================================================
  // BODY TRUNCATION
  // ==========================================================================

  describe('Body Truncation', () => {
    it('should truncate request body larger than 10KB', () => {
      const largeBody = 'x'.repeat(15 * 1024); // 15KB
      const logs = [createNetworkLog({ requestBody: largeBody })];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('[TRUNCATED - 15.0KB total]');
      expect(result.content.length).toBeLessThan(largeBody.length);
    });

    it('should truncate response body larger than 10KB', () => {
      const largeBody = 'y'.repeat(50 * 1024); // 50KB
      const logs = [createNetworkLog({ responseBody: largeBody })];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('[TRUNCATED - 50.0KB total]');
    });

    it('should not truncate bodies smaller than 10KB', () => {
      const smallBody = JSON.stringify({ data: 'x'.repeat(1000) }); // ~1KB valid JSON
      const logs = [createNetworkLog({ requestBody: smallBody })];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).not.toContain('[TRUNCATED');
      // Body is included (may be redacted if it matches patterns)
      expect(result.content).toContain('Request Body:');
    });

    it('should format large sizes in MB', () => {
      const hugeBody = 'a'.repeat(2 * 1024 * 1024); // 2MB
      const logs = [createNetworkLog({ responseBody: hugeBody })];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('[TRUNCATED - 2.0MB total]');
    });

    it('should apply redaction before truncation', () => {
      const largeBodyWithSecret = '{"password":"secret123",' + 'x'.repeat(15 * 1024) + '}';
      const logs = [createNetworkLog({ requestBody: largeBodyWithSecret })];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('password=[REDACTED]');
      expect(result.content).not.toContain('secret123');
      expect(result.content).toContain('[TRUNCATED');
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty logs array', () => {
      const result = formatter.format([]);

      expect(result.entryCount).toBe(0);
      expect(result.filteredCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.content).toContain('No network requests logged');
    });

    it('should handle logs with no headers', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: undefined,
          responseHeaders: undefined,
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).not.toContain('Request Headers:');
      expect(result.content).not.toContain('Response Headers:');
    });

    it('should handle logs with empty headers object', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: {},
          responseHeaders: {},
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).not.toContain('Request Headers:');
      expect(result.content).not.toContain('Response Headers:');
    });

    it('should handle logs with no error', () => {
      const logs = [createNetworkLog({ error: undefined })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).not.toContain('Error:');
    });

    it('should handle logs with special characters in URL', () => {
      const logs = [
        createNetworkLog({
          url: 'https://api.example.com/search?q=hello%20world&filter=type%3Duser',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('hello%20world');
      expect(result.content).toContain('type%3Duser');
    });

    it('should handle logs with non-JSON body content', () => {
      const logs = [
        createNetworkLog({
          requestBody: '<xml><user>John</user></xml>',
          responseBody: 'Plain text response',
        }),
      ];

      const result = formatter.format(logs, {
        format: 'text',
        includeBodies: true,
      });

      expect(result.content).toContain('<xml>');
      expect(result.content).toContain('Plain text response');
    });

    it('should handle logs with very long URLs', () => {
      const longUrl =
        'https://api.example.com/very/long/path/that/goes/on/and/on?param1=value1&param2=value2&param3=value3&param4=value4&param5=value5';
      const logs = [createNetworkLog({ url: longUrl })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain(longUrl);
    });

    it('should handle logs with zero duration', () => {
      const logs = [createNetworkLog({ duration: 0 })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('0ms');
    });

    it('should handle logs with unusual status codes', () => {
      const logs = [
        createNetworkLog({ status: 100 }), // Continue
        createNetworkLog({ status: 418 }), // I'm a teapot
        createNetworkLog({ status: 999 }), // Non-standard
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('100');
      expect(result.content).toContain('418');
      expect(result.content).toContain('999');
    });

    it('should handle markdown format with no failed requests', () => {
      const logs = [createNetworkLog({ status: 200 }), createNetworkLog({ status: 201 })];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).not.toContain('⚠️');
      expect(result.content).not.toContain('failed request');
    });

    it('should handle HAR format with minimal data', () => {
      const logs = [
        createNetworkLog({
          requestHeaders: undefined,
          responseHeaders: undefined,
          requestBody: undefined,
          responseBody: undefined,
        }),
      ];

      const result = formatter.format(logs, { format: 'har' });
      const parsed = JSON.parse(result.content);

      expect(parsed.log.entries).toHaveLength(1);
      expect(parsed.log.entries[0].request.headers).toHaveLength(0);
      expect(parsed.log.entries[0].response.headers).toHaveLength(0);
    });
  });
});
