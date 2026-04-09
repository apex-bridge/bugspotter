/**
 * Security tests for http.fetch RPC method
 * Tests URL validation, SSRF prevention, timeout, and logging
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RpcBridge } from '../../src/integrations/security/rpc-bridge.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';

// Mock fetch globally
const originalFetch = global.fetch;

describe('RPC Bridge - HTTP Fetch', () => {
  let rpcBridge: RpcBridge;
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;
  const testProjectId = 'test-project-123';

  beforeEach(() => {
    // Mock database client
    mockDb = {} as DatabaseClient;

    // Mock storage service
    mockStorage = {} as IStorageService;

    rpcBridge = new RpcBridge(mockDb, mockStorage, testProjectId, 'test-platform');

    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('URL Validation', () => {
    it('should reject invalid URLs', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['not-a-url', {}],
        requestId: 'req-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should reject non-HTTP protocols', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['ftp://example.com/file.txt', {}],
        requestId: 'req-2',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Protocol not allowed');
    });

    it('should reject file:// protocol', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['file:///etc/passwd', {}],
        requestId: 'req-3',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Protocol not allowed');
    });
  });

  describe('SSRF Prevention', () => {
    it('should reject localhost requests', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['http://localhost:8080/admin', {}],
        requestId: 'req-4',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal/private networks');
    });

    it('should reject 127.0.0.1 requests', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['http://127.0.0.1/secret', {}],
        requestId: 'req-5',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal/private networks');
    });

    it('should reject private network 192.168.x.x', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['http://192.168.1.1/router', {}],
        requestId: 'req-6',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal/private networks');
    });

    it('should reject private network 10.x.x.x', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['http://10.0.0.1/internal', {}],
        requestId: 'req-7',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal/private networks');
    });

    it('should reject private network 172.x.x.x', async () => {
      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['http://172.16.0.1/private', {}],
        requestId: 'req-8',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal/private networks');
    });
  });

  describe('Successful Requests', () => {
    it('should allow HTTPS requests to public domains', async () => {
      const bodyText = '{"success":true}';
      const encoder = new TextEncoder();
      const bodyBytes = encoder.encode(bodyText);

      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
          },
        }),
        text: async () => bodyText,
      } as Response);

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com/tickets', { method: 'POST' }],
        requestId: 'req-9',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"success":true}',
      });
    });

    it('should pass through HTTP method and options', async () => {
      const bodyText = '';
      const encoder = new TextEncoder();
      const bodyBytes = encoder.encode(bodyText);

      vi.mocked(global.fetch).mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: new Headers(),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
          },
        }),
        text: async () => bodyText,
      } as Response);

      await rpcBridge.handleCall({
        method: 'http.fetch',
        args: [
          'https://api.example.com/issues',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Bug' }),
          },
        ],
        requestId: 'req-10',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/issues',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Bug' }),
        })
      );
    });

    it('should convert headers to plain object', async () => {
      const headers = new Headers();
      headers.set('x-custom', 'value');
      headers.set('content-type', 'text/html');

      const bodyText = '<html></html>';
      const encoder = new TextEncoder();
      const bodyBytes = encoder.encode(bodyText);

      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
          },
        }),
        text: async () => bodyText,
      } as Response);

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://example.com', {}],
        requestId: 'req-11',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        headers: {
          'x-custom': 'value',
          'content-type': 'text/html',
        },
      });
    });
  });

  describe('Timeout Enforcement', () => {
    beforeEach(() => {
      vi.useRealTimers(); // Use real timers for timeout tests
    });

    it('should timeout after 10 seconds', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      vi.mocked(global.fetch).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(abortError), 11000);
          })
      );

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://slow-api.example.com/endpoint', {}],
        requestId: 'req-12',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    }, 15000); // Vitest timeout longer than test timeout

    it('should pass abort signal to fetch', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => 'ok',
      } as Response);

      await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com', {}],
        requestId: 'req-13',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('Redirect Prevention', () => {
    it('should set redirect to manual', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => 'ok',
      } as Response);

      await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com', {}],
        requestId: 'req-14',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          redirect: 'manual',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com', {}],
        requestId: 'req-15',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP request failed');
      expect(result.error).toContain('Network error');
    });

    it('should handle DNS resolution failures', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://nonexistent-domain-12345.com', {}],
        requestId: 'req-16',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP request failed');
    });
  });

  describe('Response Size Limits', () => {
    it('should reject responses larger than 10MB based on Content-Length header', async () => {
      const largeSize = 11 * 1024 * 1024; // 11 MB
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-length': String(largeSize),
        }),
        text: async () => 'x'.repeat(largeSize),
      } as Response);

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com/large-file', {}],
        requestId: 'req-17',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Response too large');
      expect(result.error).toContain('11.00MB exceeds 10MB limit');
    });

    it('should reject responses larger than 10MB after reading body', async () => {
      const largeBody = 'x'.repeat(11 * 1024 * 1024); // 11 MB
      const encoder = new TextEncoder();
      const largeBytes = encoder.encode(largeBody);

      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers(), // No Content-Length header
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(largeBytes);
            controller.close();
          },
        }),
        text: async () => largeBody,
      } as Response);

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com/large-response', {}],
        requestId: 'req-18',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Response body too large');
      expect(result.error).toContain('exceeded 10MB limit during streaming');
    });

    it('should allow responses within 10MB limit', async () => {
      const okSize = 5 * 1024 * 1024; // 5 MB
      const bodyText = 'x'.repeat(okSize);
      const encoder = new TextEncoder();
      const bodyBytes = encoder.encode(bodyText);

      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-length': String(okSize),
        }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
          },
        }),
        text: async () => bodyText,
      } as Response);

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com/ok-file', {}],
        requestId: 'req-19',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 200,
        body: expect.any(String),
      });
    });

    it('should handle missing Content-Length header gracefully', async () => {
      const smallBody = 'Small response';
      const encoder = new TextEncoder();
      const bodyBytes = encoder.encode(smallBody);

      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers(), // No Content-Length
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
          },
        }),
        text: async () => smallBody,
      } as Response);

      const result = await rpcBridge.handleCall({
        method: 'http.fetch',
        args: ['https://api.example.com/no-length', {}],
        requestId: 'req-20',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 200,
        body: smallBody,
      });
    });
  });
});
