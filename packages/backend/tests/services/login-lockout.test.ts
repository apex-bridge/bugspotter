/**
 * Tests for Login Lockout Service
 * Verifies account lockout after failed login attempts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkLockoutStatus,
  recordFailedAttempt,
  clearFailedAttempts,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_SECONDS,
} from '../../src/services/auth/login-lockout.js';

// Mock the Redis connection pool
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  eval: vi.fn(), // For Lua script
};

vi.mock('../../src/queue/redis-connection-pool.js', () => ({
  getConnectionPool: () => ({
    getMainConnection: vi.fn().mockResolvedValue(mockRedis),
  }),
}));

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Login Lockout Service', () => {
  const testEmail = 'test@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('checkLockoutStatus', () => {
    it('should allow login when account is not locked', async () => {
      mockRedis.ttl.mockResolvedValue(-2); // Key doesn't exist
      mockRedis.get.mockResolvedValue(null);

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(true);
      expect(result.status.isLocked).toBe(false);
      expect(result.status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS);
    });

    it('should block login when account is locked', async () => {
      mockRedis.ttl.mockResolvedValue(600); // 10 minutes remaining

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(false);
      expect(result.status.isLocked).toBe(true);
      expect(result.status.lockoutSecondsRemaining).toBe(600);
      expect(result.status.remainingAttempts).toBe(0);
    });

    it('should return correct remaining attempts', async () => {
      mockRedis.ttl.mockResolvedValue(-2); // Not locked
      mockRedis.get.mockResolvedValue('3'); // 3 failed attempts

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(true);
      expect(result.status.failedAttempts).toBe(3);
      expect(result.status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 3);
    });

    it('should fail open on Redis error', async () => {
      mockRedis.ttl.mockRejectedValue(new Error('Redis connection failed'));

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(true);
      expect(result.status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS);
    });
  });

  describe('recordFailedAttempt', () => {
    it('should increment failed attempts counter using Lua script', async () => {
      mockRedis.eval.mockResolvedValue(1);

      const status = await recordFailedAttempt(testEmail);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        expect.stringContaining(testEmail.toLowerCase()),
        LOCKOUT_DURATION_SECONDS
      );
      expect(status.isLocked).toBe(false);
      expect(status.failedAttempts).toBe(1);
      expect(status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);
    });

    it('should lock account after max failed attempts', async () => {
      mockRedis.eval.mockResolvedValue(MAX_FAILED_ATTEMPTS);
      mockRedis.setex.mockResolvedValue('OK');

      const status = await recordFailedAttempt(testEmail);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('lockout'),
        LOCKOUT_DURATION_SECONDS,
        '1'
      );
      expect(status.isLocked).toBe(true);
      expect(status.remainingAttempts).toBe(0);
      expect(status.lockoutSecondsRemaining).toBe(LOCKOUT_DURATION_SECONDS);
    });

    it('should not lock before reaching max attempts', async () => {
      mockRedis.eval.mockResolvedValue(MAX_FAILED_ATTEMPTS - 1);

      const status = await recordFailedAttempt(testEmail);

      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(1);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis connection failed'));

      const status = await recordFailedAttempt(testEmail);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS);
    });

    it('should atomically increment and set TTL in single operation', async () => {
      mockRedis.eval.mockResolvedValue(3);

      await recordFailedAttempt(testEmail);

      // Verify Lua script contains both INCR and EXPIRE
      const luaScript = mockRedis.eval.mock.calls[0][0] as string;
      expect(luaScript).toContain('INCR');
      expect(luaScript).toContain('EXPIRE');
    });
  });

  describe('clearFailedAttempts', () => {
    it('should delete both attempts and lockout keys', async () => {
      mockRedis.del.mockResolvedValue(2);

      await clearFailedAttempts(testEmail);

      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('attempts'),
        expect.stringContaining('lockout')
      );
    });

    it('should handle Redis errors without throwing', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis connection failed'));

      // Should resolve (not reject) despite Redis error
      await expect(clearFailedAttempts(testEmail)).resolves.toBeUndefined();
    });
  });

  describe('Constants', () => {
    it('should have correct default values', () => {
      expect(MAX_FAILED_ATTEMPTS).toBe(5);
      expect(LOCKOUT_DURATION_SECONDS).toBe(15 * 60); // 15 minutes
    });
  });

  describe('Email normalization', () => {
    it('should treat emails case-insensitively', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue(null);

      await checkLockoutStatus('TEST@EXAMPLE.COM');

      // Should use lowercase email in Redis key
      expect(mockRedis.ttl).toHaveBeenCalledWith(expect.stringContaining('test@example.com'));
    });

    it('should handle single-character local part', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue(null);

      await checkLockoutStatus('a@example.com');

      // Should use lowercase email in Redis key
      expect(mockRedis.ttl).toHaveBeenCalledWith(expect.stringContaining('a@example.com'));
    });

    it('should handle single-part domain (localhost)', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue(null);

      await checkLockoutStatus('user@localhost');

      expect(mockRedis.ttl).toHaveBeenCalledWith(expect.stringContaining('user@localhost'));
    });

    it('should handle complex email formats', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue(null);

      await checkLockoutStatus('user+tag@sub.example.co.uk');

      expect(mockRedis.ttl).toHaveBeenCalledWith(
        expect.stringContaining('user+tag@sub.example.co.uk')
      );
    });
  });

  describe('TTL edge cases', () => {
    it('should handle TTL = 0 (key expired)', async () => {
      mockRedis.ttl.mockResolvedValue(0);

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(true);
      expect(result.status.isLocked).toBe(false);
    });

    it('should handle TTL = -1 (key exists but no expiry)', async () => {
      mockRedis.ttl.mockResolvedValue(-1);

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(true);
      expect(result.status.isLocked).toBe(false);
    });

    it('should handle TTL = -2 (key does not exist)', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue(null);

      const result = await checkLockoutStatus(testEmail);

      expect(result.canAttempt).toBe(true);
      expect(result.status.isLocked).toBe(false);
    });
  });

  describe('getLockoutStatus', () => {
    it('should return status without modifying state', async () => {
      mockRedis.ttl.mockResolvedValue(300);

      const { getLockoutStatus } = await import('../../src/services/auth/login-lockout.js');
      const status = await getLockoutStatus(testEmail);

      expect(status.isLocked).toBe(true);
      expect(status.lockoutSecondsRemaining).toBe(300);
    });

    it('should return unlocked status when no lockout exists', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue('2');

      const { getLockoutStatus } = await import('../../src/services/auth/login-lockout.js');
      const status = await getLockoutStatus(testEmail);

      expect(status.isLocked).toBe(false);
      expect(status.failedAttempts).toBe(2);
      expect(status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 2);
    });
  });

  describe('Boundary conditions', () => {
    it('should handle attempt count at exact threshold', async () => {
      mockRedis.eval.mockResolvedValue(MAX_FAILED_ATTEMPTS);
      mockRedis.setex.mockResolvedValue('OK');

      const status = await recordFailedAttempt(testEmail);

      expect(status.isLocked).toBe(true);
      expect(status.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    });

    it('should handle attempt count exceeding threshold', async () => {
      mockRedis.eval.mockResolvedValue(MAX_FAILED_ATTEMPTS + 5);
      mockRedis.setex.mockResolvedValue('OK');

      const status = await recordFailedAttempt(testEmail);

      expect(status.isLocked).toBe(true);
      expect(status.remainingAttempts).toBe(0);
    });

    it('should handle zero failed attempts', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      mockRedis.get.mockResolvedValue('0');

      const result = await checkLockoutStatus(testEmail);

      expect(result.status.failedAttempts).toBe(0);
      expect(result.status.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS);
    });
  });
});
