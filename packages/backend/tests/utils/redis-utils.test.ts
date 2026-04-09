/**
 * Redis Utilities Tests
 * Tests for Redis URL sanitization and error logging helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sanitizeRedisUrl,
  createCriticalRedisError,
  logCriticalRedisError,
} from '../../src/utils/redis-utils.js';

describe('Redis Utilities', () => {
  describe('sanitizeRedisUrl', () => {
    it('should hide password in Redis URL', () => {
      const url = 'redis://:mypassword123@localhost:6379';
      expect(sanitizeRedisUrl(url)).toBe('redis://:***@localhost:6379');
    });

    it('should handle URLs with username and password', () => {
      const url = 'redis://user:password@redis.example.com:6379';
      expect(sanitizeRedisUrl(url)).toBe('redis://user:***@redis.example.com:6379');
    });

    it('should handle complex passwords with special characters', () => {
      const url = 'redis://:p$ssw0rd!#$@host:6379/0';
      expect(sanitizeRedisUrl(url)).toBe('redis://:***@host:6379/0');
    });

    it('should return "not set" when URL is undefined', () => {
      expect(sanitizeRedisUrl(undefined)).toBe('not set');
    });

    it('should handle empty string', () => {
      expect(sanitizeRedisUrl('')).toBe('not set');
    });

    it('should handle Upstash Redis URLs', () => {
      const url = 'rediss://:token123@usw1-redis.upstash.io:6379';
      expect(sanitizeRedisUrl(url)).toBe('rediss://:***@usw1-redis.upstash.io:6379');
    });
  });

  describe('createCriticalRedisError', () => {
    it('should create error object with all required fields', () => {
      const error = createCriticalRedisError(
        'Connection refused',
        'Check Redis service',
        'redis://:pass@localhost:6379'
      );

      expect(error).toHaveProperty('error', 'Connection refused');
      expect(error).toHaveProperty('action', 'Check Redis service');
      expect(error).toHaveProperty('redisUrl', 'redis://:***@localhost:6379');
      expect(error).toHaveProperty('timestamp');
      expect(typeof error.timestamp).toBe('string');
    });

    it('should handle undefined Redis URL', () => {
      const error = createCriticalRedisError(
        'Connection failed',
        'Verify configuration',
        undefined
      );

      expect(error.redisUrl).toBe('not set');
    });

    it('should merge additional fields', () => {
      const error = createCriticalRedisError(
        'Database suspended',
        'Contact support',
        'redis://:pass@host:6379',
        { provider: 'Upstash', accountId: '12345' }
      );

      expect(error).toHaveProperty('provider', 'Upstash');
      expect(error).toHaveProperty('accountId', '12345');
      expect(error).toHaveProperty('error', 'Database suspended');
    });

    it('should include valid ISO timestamp', () => {
      const error = createCriticalRedisError('Test error', 'Test action', 'redis://localhost');

      expect(error.timestamp).toBeDefined();
      // Verify it's a valid ISO string
      const timestamp = new Date(error.timestamp as string);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });
  });

  describe('logCriticalRedisError', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('should log suspended database error', () => {
      logCriticalRedisError(
        'This database has been suspended',
        'redis://:pass@localhost:6379',
        'startup'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[CRITICAL] [startup] Redis database suspended:',
        expect.objectContaining({
          error: 'This database has been suspended',
          action: 'Contact your Redis provider support to reactivate the database',
          redisUrl: 'redis://:***@localhost:6379',
        })
      );
    });

    it('should log connection refused error', () => {
      logCriticalRedisError('ECONNREFUSED', 'redis://:pass@host:6379', 'runtime');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[CRITICAL] [runtime] Redis connection refused:',
        expect.objectContaining({
          error: 'ECONNREFUSED',
          action: 'Verify Redis service is running and REDIS_URL is correctly configured',
          redisUrl: 'redis://:***@host:6379',
        })
      );
    });

    it('should log generic startup error for other error types', () => {
      logCriticalRedisError('Unknown connection error', 'redis://localhost', 'startup');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[CRITICAL] [startup] Redis connection failed:',
        expect.objectContaining({
          error: 'Unknown connection error',
          action: 'Check Redis configuration and connectivity',
        })
      );
    });

    it('should handle Error objects', () => {
      const error = new Error('ECONNREFUSED');
      logCriticalRedisError(error, 'redis://localhost', 'runtime');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[CRITICAL] [runtime] Redis connection refused:',
        expect.objectContaining({
          error: 'ECONNREFUSED',
        })
      );
    });

    it('should work without context parameter', () => {
      logCriticalRedisError('suspended database', 'redis://localhost');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[CRITICAL] Redis database suspended:',
        expect.any(Object)
      );
    });
  });
});
