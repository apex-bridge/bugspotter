/**
 * Tests for metadata extraction utilities
 */

import { describe, it, expect } from 'vitest';
import {
  extractEnvironment,
  extractConsoleLogs,
  extractNetworkErrors,
} from '../../../src/integrations/plugin-utils/metadata.js';
import type { BugReportMetadata } from '../../../src/integrations/plugin-utils/metadata.js';

describe('Plugin Utils - Metadata', () => {
  describe('extractEnvironment', () => {
    it('should extract full environment data', () => {
      const metadata: BugReportMetadata = {
        browser: 'Chrome',
        browserVersion: '120.0.0',
        os: 'Windows',
        osVersion: '11',
        viewport: '1920x1080',
        url: 'https://example.com/page',
        userAgent: 'Mozilla/5.0...',
      };

      const env = extractEnvironment(metadata);

      expect(env).toEqual({
        browser: 'Chrome',
        browserVersion: '120.0.0',
        os: 'Windows',
        osVersion: '11',
        viewport: '1920x1080',
        url: 'https://example.com/page',
        userAgent: 'Mozilla/5.0...',
      });
    });

    it('should provide defaults for missing fields', () => {
      const metadata: BugReportMetadata = {
        browser: 'Firefox',
        os: 'macOS',
      };

      const env = extractEnvironment(metadata);

      expect(env).toEqual({
        browser: 'Firefox',
        browserVersion: 'Unknown',
        os: 'macOS',
        osVersion: 'Unknown',
        viewport: 'Unknown',
        url: 'Unknown',
        userAgent: 'Unknown',
      });
    });

    it('should handle null metadata', () => {
      const env = extractEnvironment(null);

      expect(env).toEqual({
        browser: 'Unknown',
        browserVersion: 'Unknown',
        os: 'Unknown',
        osVersion: 'Unknown',
        viewport: 'Unknown',
        url: 'Unknown',
        userAgent: 'Unknown',
      });
    });

    it('should handle undefined metadata', () => {
      const env = extractEnvironment(undefined);

      expect(env).toEqual({
        browser: 'Unknown',
        browserVersion: 'Unknown',
        os: 'Unknown',
        osVersion: 'Unknown',
        viewport: 'Unknown',
        url: 'Unknown',
        userAgent: 'Unknown',
      });
    });

    it('should handle empty metadata', () => {
      const env = extractEnvironment({});

      expect(env).toEqual({
        browser: 'Unknown',
        browserVersion: 'Unknown',
        os: 'Unknown',
        osVersion: 'Unknown',
        viewport: 'Unknown',
        url: 'Unknown',
        userAgent: 'Unknown',
      });
    });
  });

  describe('extractConsoleLogs', () => {
    it('should extract console logs with default limit', () => {
      const metadata: BugReportMetadata = {
        console: Array.from({ length: 15 }, (_, i) => ({
          level: 'log',
          message: `Log ${i + 1}`,
          timestamp: `2025-01-01T00:00:${i}Z`,
        })),
      };

      const logs = extractConsoleLogs(metadata);

      expect(logs).toHaveLength(10); // Default limit
      expect(logs[0].message).toBe('Log 6'); // Last 10 entries
      expect(logs[9].message).toBe('Log 15');
    });

    it('should respect custom limit', () => {
      const metadata: BugReportMetadata = {
        console: Array.from({ length: 10 }, (_, i) => ({
          level: 'log',
          message: `Log ${i + 1}`,
          timestamp: `2025-01-01T00:00:${i}Z`,
        })),
      };

      const logs = extractConsoleLogs(metadata, 5);

      expect(logs).toHaveLength(5);
      expect(logs[0].message).toBe('Log 6');
      expect(logs[4].message).toBe('Log 10');
    });

    it('should handle logs with different levels', () => {
      const metadata: BugReportMetadata = {
        console: [
          { level: 'log', message: 'Info message', timestamp: '2025-01-01T00:00:00Z' },
          { level: 'error', message: 'Error message', timestamp: '2025-01-01T00:00:01Z' },
          { level: 'warn', message: 'Warning message', timestamp: '2025-01-01T00:00:02Z' },
        ],
      };

      const logs = extractConsoleLogs(metadata);

      expect(logs).toHaveLength(3);
      expect(logs[0].level).toBe('log');
      expect(logs[1].level).toBe('error');
      expect(logs[2].level).toBe('warn');
    });

    it('should provide defaults for missing fields', () => {
      const metadata: BugReportMetadata = {
        console: [{}, { level: 'error' }, { message: 'Test' }] as any,
      };

      const logs = extractConsoleLogs(metadata);

      expect(logs).toHaveLength(3);
      expect(logs[0]).toEqual({ level: 'log', message: '', timestamp: '' });
      expect(logs[1]).toEqual({ level: 'error', message: '', timestamp: '' });
      expect(logs[2]).toEqual({ level: 'log', message: 'Test', timestamp: '' });
    });

    it('should return empty array for null metadata', () => {
      const logs = extractConsoleLogs(null);

      expect(logs).toEqual([]);
    });

    it('should return empty array for undefined metadata', () => {
      const logs = extractConsoleLogs(undefined);

      expect(logs).toEqual([]);
    });

    it('should return empty array for missing console field', () => {
      const logs = extractConsoleLogs({});

      expect(logs).toEqual([]);
    });

    it('should return empty array for empty console array', () => {
      const metadata: BugReportMetadata = {
        console: [],
      };

      const logs = extractConsoleLogs(metadata);

      expect(logs).toEqual([]);
    });
  });

  describe('extractNetworkErrors', () => {
    it('should extract failed network requests', () => {
      const metadata: BugReportMetadata = {
        network: [
          { method: 'GET', url: '/api/data', status: 200, statusText: 'OK' },
          { method: 'POST', url: '/api/submit', status: 404, statusText: 'Not Found' },
          { method: 'GET', url: '/api/error', status: 500, statusText: 'Internal Server Error' },
          { method: 'PUT', url: '/api/update', status: 201, statusText: 'Created' },
        ],
      };

      const errors = extractNetworkErrors(metadata);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toEqual({
        method: 'POST',
        url: '/api/submit',
        status: 404,
        statusText: 'Not Found',
      });
      expect(errors[1]).toEqual({
        method: 'GET',
        url: '/api/error',
        status: 500,
        statusText: 'Internal Server Error',
      });
    });

    it('should filter out successful requests (< 400)', () => {
      const metadata: BugReportMetadata = {
        network: [
          { method: 'GET', url: '/api/1', status: 200 },
          { method: 'GET', url: '/api/2', status: 201 },
          { method: 'GET', url: '/api/3', status: 204 },
          { method: 'GET', url: '/api/4', status: 301 },
          { method: 'GET', url: '/api/5', status: 304 },
          { method: 'GET', url: '/api/6', status: 399 },
        ],
      };

      const errors = extractNetworkErrors(metadata);

      expect(errors).toEqual([]);
    });

    it('should include all error status codes', () => {
      const metadata: BugReportMetadata = {
        network: [
          { method: 'GET', url: '/400', status: 400 },
          { method: 'GET', url: '/401', status: 401 },
          { method: 'GET', url: '/403', status: 403 },
          { method: 'GET', url: '/404', status: 404 },
          { method: 'GET', url: '/429', status: 429 },
          { method: 'GET', url: '/500', status: 500 },
          { method: 'GET', url: '/502', status: 502 },
          { method: 'GET', url: '/503', status: 503 },
        ],
      };

      const errors = extractNetworkErrors(metadata);

      expect(errors).toHaveLength(8);
    });

    it('should provide defaults for missing fields', () => {
      const metadata: BugReportMetadata = {
        network: [
          { status: 404 },
          { method: 'POST', status: 500 },
          { method: 'GET', url: '/api/test', status: 400 },
        ] as any,
      };

      const errors = extractNetworkErrors(metadata);

      expect(errors).toHaveLength(3);
      expect(errors[0]).toEqual({ method: 'GET', url: '', status: 404, statusText: '' });
      expect(errors[1]).toEqual({ method: 'POST', url: '', status: 500, statusText: '' });
      expect(errors[2]).toEqual({ method: 'GET', url: '/api/test', status: 400, statusText: '' });
    });

    it('should return empty array for null metadata', () => {
      const errors = extractNetworkErrors(null);

      expect(errors).toEqual([]);
    });

    it('should return empty array for undefined metadata', () => {
      const errors = extractNetworkErrors(undefined);

      expect(errors).toEqual([]);
    });

    it('should return empty array for missing network field', () => {
      const errors = extractNetworkErrors({});

      expect(errors).toEqual([]);
    });

    it('should return empty array for empty network array', () => {
      const metadata: BugReportMetadata = {
        network: [],
      };

      const errors = extractNetworkErrors(metadata);

      expect(errors).toEqual([]);
    });
  });
});
