/**
 * Tests for HTTP utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildUrl,
  parseResponse,
  makeApiRequest,
} from '../../../src/integrations/plugin-utils/http.js';
import type { HttpContext } from '../../../src/integrations/plugin-utils/http.js';
import { ERROR_CODES } from '../../../src/integrations/plugin-utils/errors.js';

describe('Plugin Utils - HTTP', () => {
  describe('buildUrl', () => {
    it('should build URL without query params', () => {
      const url = buildUrl('https://api.example.com', '/users');

      expect(url).toBe('https://api.example.com/users');
    });

    it('should build URL with query params', () => {
      const url = buildUrl('https://api.example.com', '/users', { page: 1, limit: 10 });

      expect(url).toBe('https://api.example.com/users?page=1&limit=10');
    });

    it('should skip null/undefined query params', () => {
      const url = buildUrl('https://api.example.com', '/search', {
        q: 'test',
        filter: null,
        sort: undefined,
        limit: 10,
      });

      expect(url).toBe('https://api.example.com/search?q=test&limit=10');
    });

    it('should handle trailing slash in base URL', () => {
      const url = buildUrl('https://api.example.com/', '/users');

      expect(url).toBe('https://api.example.com/users');
    });

    it('should handle endpoint without leading slash', () => {
      const url = buildUrl('https://api.example.com', 'users');

      expect(url).toBe('https://api.example.com/users');
    });

    it('should handle special characters in query params', () => {
      const url = buildUrl('https://api.example.com', '/search', {
        q: 'hello world',
        tag: 'c++',
      });

      expect(url).toContain('q=hello+world');
      expect(url).toContain('tag=c%2B%2B');
    });
  });

  describe('parseResponse', () => {
    it('should parse JSON response', async () => {
      const mockResponse = {
        headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
        json: vi.fn().mockResolvedValue({ data: 'test' }),
        text: vi.fn(),
      };

      const result = await parseResponse(mockResponse);

      expect(result).toEqual({ data: 'test' });
      expect(mockResponse.json).toHaveBeenCalled();
      expect(mockResponse.text).not.toHaveBeenCalled();
    });

    it('should parse text response', async () => {
      const mockResponse = {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/plain' : null) },
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('plain text'),
      };

      const result = await parseResponse(mockResponse);

      expect(result).toBe('plain text');
      expect(mockResponse.text).toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should default to text for unknown content type', async () => {
      const mockResponse = {
        headers: { get: () => null },
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('response'),
      };

      const result = await parseResponse(mockResponse);

      expect(result).toBe('response');
      expect(mockResponse.text).toHaveBeenCalled();
    });

    it('should try JSON with defaultFormat option', async () => {
      const mockResponse = {
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({ parsed: true }),
        text: vi.fn().mockResolvedValue('fallback'),
      };

      const result = await parseResponse(mockResponse, { defaultFormat: 'json' });

      expect(result).toEqual({ parsed: true });
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should fallback to text if JSON parsing fails', async () => {
      const mockResponse = {
        headers: { get: () => null },
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: vi.fn().mockResolvedValue('not json'),
      };

      const result = await parseResponse(mockResponse, { defaultFormat: 'json' });

      expect(result).toBe('not json');
    });
  });

  describe('makeApiRequest', () => {
    let mockContext: HttpContext;

    beforeEach(() => {
      mockContext = {
        fetch: vi.fn(),
      };
    });

    it('should make successful GET request', async () => {
      const mockResponse = {
        status: 200,
        headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
        json: vi.fn().mockResolvedValue({ success: true }),
        text: vi.fn(),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      const result = await makeApiRequest(mockContext, {
        baseUrl: 'https://api.example.com',
        endpoint: '/users',
      });

      expect(result).toEqual({ success: true });
      expect(mockContext.fetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'BugSpotter/1.0',
          }),
        })
      );
    });

    it('should make POST request with body', async () => {
      const mockResponse = {
        status: 201,
        headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
        json: vi.fn().mockResolvedValue({ id: '123' }),
        text: vi.fn(),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      const result = await makeApiRequest(mockContext, {
        baseUrl: 'https://api.example.com',
        endpoint: '/users',
        method: 'POST',
        body: { name: 'Test User' },
      });

      expect(result).toEqual({ id: '123' });
      expect(mockContext.fetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test User' }),
        })
      );
    });

    it('should include authorization header', async () => {
      const mockResponse = {
        status: 200,
        headers: { get: () => 'application/json' },
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn(),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await makeApiRequest(mockContext, {
        baseUrl: 'https://api.example.com',
        endpoint: '/protected',
        authHeader: 'Bearer token123',
      });

      expect(mockContext.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123',
          }),
        })
      );
    });

    it('should include custom headers', async () => {
      const mockResponse = {
        status: 200,
        headers: { get: () => 'application/json' },
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn(),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await makeApiRequest(mockContext, {
        baseUrl: 'https://api.example.com',
        endpoint: '/data',
        customHeaders: {
          'X-Custom-Header': 'value',
        },
      });

      expect(mockContext.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'value',
          }),
        })
      );
    });

    it('should throw PluginError on 4xx status', async () => {
      const mockResponse = {
        status: 404,
        headers: { get: () => null },
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('Not found'),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await expect(
        makeApiRequest(mockContext, {
          baseUrl: 'https://api.example.com',
          endpoint: '/missing',
        })
      ).rejects.toThrow('API request failed (404)');
    });

    it('should throw PluginError on 5xx status', async () => {
      const mockResponse = {
        status: 500,
        headers: { get: () => null },
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('Internal server error'),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await expect(
        makeApiRequest(mockContext, {
          baseUrl: 'https://api.example.com',
          endpoint: '/error',
        })
      ).rejects.toThrow('API request failed (500)');
    });

    it('should use custom error prefix', async () => {
      const mockResponse = {
        status: 401,
        headers: { get: () => null },
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await expect(
        makeApiRequest(mockContext, {
          baseUrl: 'https://api.example.com',
          endpoint: '/auth',
          errorPrefix: 'Authentication failed',
        })
      ).rejects.toThrow('Authentication failed (401)');
    });

    it('should handle network errors', async () => {
      (mockContext.fetch as any).mockRejectedValue(new Error('Network timeout'));

      await expect(
        makeApiRequest(mockContext, {
          baseUrl: 'https://api.example.com',
          endpoint: '/data',
        })
      ).rejects.toThrow('Network request failed: Network timeout');
    });

    it('should preserve existing PluginError', async () => {
      const originalError = {
        code: ERROR_CODES.RATE_LIMIT,
        message: 'Rate limit exceeded',
      };

      (mockContext.fetch as any).mockRejectedValue(originalError);

      await expect(
        makeApiRequest(mockContext, {
          baseUrl: 'https://api.example.com',
          endpoint: '/data',
        })
      ).rejects.toMatchObject(originalError);
    });

    it('should handle string body', async () => {
      const mockResponse = {
        status: 200,
        headers: { get: () => 'application/json' },
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn(),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await makeApiRequest(mockContext, {
        baseUrl: 'https://api.example.com',
        endpoint: '/data',
        method: 'POST',
        body: 'raw string body',
      });

      expect(mockContext.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: 'raw string body',
        })
      );
    });

    it('should set custom timeout', async () => {
      const mockResponse = {
        status: 200,
        headers: { get: () => 'application/json' },
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn(),
      };

      (mockContext.fetch as any).mockResolvedValue(mockResponse);

      await makeApiRequest(mockContext, {
        baseUrl: 'https://api.example.com',
        endpoint: '/slow',
        timeout: 5000,
      });

      expect(mockContext.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });
  });
});
