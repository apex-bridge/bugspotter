/**
 * Auth Response Helpers Unit Tests
 * Tests for standardized error response functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import {
  sendUnauthorized,
  sendForbidden,
  sendRateLimitExceeded,
  sendInternalError,
} from '../../src/api/middleware/auth/responses.js';

describe('Auth Response Helpers', () => {
  let mockReply: Partial<FastifyReply>;
  let codeSpy: ReturnType<typeof vi.fn>;
  let sendSpy: ReturnType<typeof vi.fn>;
  let headerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    headerSpy = vi.fn(function (this: any) {
      return this;
    });
    codeSpy = vi.fn(() => ({ header: headerSpy, send: sendSpy }));

    mockReply = {
      code: codeSpy as any,
      header: headerSpy as any,
      send: sendSpy,
    };
  });

  describe('sendUnauthorized', () => {
    it('should send 401 response with correct structure', () => {
      sendUnauthorized(mockReply as FastifyReply, 'Invalid API key');

      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Unauthorized',
          message: 'Invalid API key',
          statusCode: 401,
          timestamp: expect.any(String),
        })
      );
    });

    it('should include valid ISO timestamp', () => {
      sendUnauthorized(mockReply as FastifyReply, 'Test message');

      const callArgs = sendSpy.mock.calls[0][0];
      const timestamp = new Date(callArgs.timestamp);
      expect(timestamp.toISOString()).toBe(callArgs.timestamp);
    });

    it('should handle different error messages', () => {
      const messages = [
        'Invalid API key',
        'Token expired',
        'Authentication required',
        'User not found',
      ];

      messages.forEach((message) => {
        sendSpy.mockClear();
        codeSpy.mockClear();

        sendUnauthorized(mockReply as FastifyReply, message);

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message,
          })
        );
      });
    });
  });

  describe('sendForbidden', () => {
    it('should send 403 response with correct structure', () => {
      sendForbidden(mockReply as FastifyReply, 'Insufficient permissions');

      expect(codeSpy).toHaveBeenCalledWith(403);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Forbidden',
          message: 'Insufficient permissions',
          statusCode: 403,
          timestamp: expect.any(String),
        })
      );
    });

    it('should include valid ISO timestamp', () => {
      sendForbidden(mockReply as FastifyReply, 'Access denied');

      const callArgs = sendSpy.mock.calls[0][0];
      const timestamp = new Date(callArgs.timestamp);
      expect(timestamp.toISOString()).toBe(callArgs.timestamp);
    });

    it('should handle different error messages', () => {
      const messages = ['Insufficient permissions', 'Admin role required', 'Project access denied'];

      messages.forEach((message) => {
        sendSpy.mockClear();
        codeSpy.mockClear();

        sendForbidden(mockReply as FastifyReply, message);

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message,
            statusCode: 403,
          })
        );
      });
    });
  });

  describe('sendRateLimitExceeded', () => {
    it('should send 429 response with correct structure', () => {
      sendRateLimitExceeded(mockReply as FastifyReply, 'minute', 45);

      expect(codeSpy).toHaveBeenCalledWith(429);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'TooManyRequests',
          message: 'Rate limit exceeded for minute window. Try again in 45s',
          retryAfter: 45,
          statusCode: 429,
          timestamp: expect.any(String),
        })
      );
    });

    it('should include valid ISO timestamp', () => {
      sendRateLimitExceeded(mockReply as FastifyReply, 'hour', 120);

      const callArgs = sendSpy.mock.calls[0][0];
      const timestamp = new Date(callArgs.timestamp);
      expect(timestamp.toISOString()).toBe(callArgs.timestamp);
    });

    it('should format message with different windows', () => {
      const windows: Array<{ window: string; retryAfter: number }> = [
        { window: 'minute', retryAfter: 30 },
        { window: 'hour', retryAfter: 300 },
        { window: 'day', retryAfter: 3600 },
      ];

      windows.forEach(({ window, retryAfter }) => {
        sendSpy.mockClear();
        codeSpy.mockClear();

        sendRateLimitExceeded(mockReply as FastifyReply, window, retryAfter);

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: `Rate limit exceeded for ${window} window. Try again in ${retryAfter}s`,
            retryAfter,
          })
        );
      });
    });

    it('should handle edge case retry times', () => {
      const retryCases = [0, 1, 59, 60, 3600, 86400];

      retryCases.forEach((retryAfter) => {
        sendSpy.mockClear();
        codeSpy.mockClear();

        sendRateLimitExceeded(mockReply as FastifyReply, 'minute', retryAfter);

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            retryAfter,
          })
        );
      });
    });
  });

  describe('sendInternalError', () => {
    it('should send 500 response with correct structure', () => {
      sendInternalError(mockReply as FastifyReply, 'Database connection failed');

      expect(codeSpy).toHaveBeenCalledWith(500);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'InternalServerError',
          message: 'Database connection failed',
          statusCode: 500,
          timestamp: expect.any(String),
        })
      );
    });

    it('should include valid ISO timestamp', () => {
      sendInternalError(mockReply as FastifyReply, 'Test error');

      const callArgs = sendSpy.mock.calls[0][0];
      const timestamp = new Date(callArgs.timestamp);
      expect(timestamp.toISOString()).toBe(callArgs.timestamp);
    });

    it('should handle different error messages', () => {
      const messages = [
        'Authentication failed',
        'Database connection failed',
        'Service unavailable',
        'Unexpected error occurred',
      ];

      messages.forEach((message) => {
        sendSpy.mockClear();
        codeSpy.mockClear();

        sendInternalError(mockReply as FastifyReply, message);

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message,
            statusCode: 500,
          })
        );
      });
    });
  });

  describe('Response Consistency', () => {
    it('should always include success: false in all error responses', () => {
      const responses = [
        () => sendUnauthorized(mockReply as FastifyReply, 'test'),
        () => sendForbidden(mockReply as FastifyReply, 'test'),
        () => sendRateLimitExceeded(mockReply as FastifyReply, 'minute', 60),
        () => sendInternalError(mockReply as FastifyReply, 'test'),
      ];

      responses.forEach((responseFn) => {
        sendSpy.mockClear();
        responseFn();

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
          })
        );
      });
    });

    it('should always include timestamp in all responses', () => {
      const responses = [
        () => sendUnauthorized(mockReply as FastifyReply, 'test'),
        () => sendForbidden(mockReply as FastifyReply, 'test'),
        () => sendRateLimitExceeded(mockReply as FastifyReply, 'minute', 60),
        () => sendInternalError(mockReply as FastifyReply, 'test'),
      ];

      responses.forEach((responseFn) => {
        sendSpy.mockClear();
        responseFn();

        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            timestamp: expect.any(String),
          })
        );
      });
    });

    it('should always include statusCode matching HTTP code', () => {
      const testCases = [
        { fn: sendUnauthorized, code: 401 },
        { fn: sendForbidden, code: 403 },
        { fn: sendInternalError, code: 500 },
      ];

      testCases.forEach(({ fn, code }) => {
        sendSpy.mockClear();
        codeSpy.mockClear();

        if (fn === sendRateLimitExceeded) {
          (fn as any)(mockReply, 'minute', 60);
        } else {
          fn(mockReply as FastifyReply, 'test');
        }

        expect(codeSpy).toHaveBeenCalledWith(code);
        expect(sendSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: code,
          })
        );
      });
    });
  });
});
