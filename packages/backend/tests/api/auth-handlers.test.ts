/**
 * Auth Handler Functions Unit Tests
 * Tests for authentication handler logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { handleNewApiKeyAuth, handleJwtAuth } from '../../src/api/middleware/auth/handlers.js';
import type { ApiKey, User, Project } from '../../src/db/types.js';

describe('Auth Handler Functions', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  let mockApiKeyService: any;
  let mockDb: any;
  let codeSpy: ReturnType<typeof vi.fn>;
  let sendSpy: ReturnType<typeof vi.fn>;
  let headerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    headerSpy = vi.fn(function (this: any) {
      return this;
    });
    codeSpy = vi.fn(() => ({ header: headerSpy, send: sendSpy }));

    mockRequest = {
      url: '/api/v1/reports',
      method: 'POST',
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'test-agent',
      },
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };

    mockReply = {
      code: codeSpy as any,
      header: headerSpy as any,
      send: sendSpy,
    };

    mockApiKeyService = {
      verifyAndGetKey: vi.fn(),
      checkRateLimit: vi.fn(),
      trackUsage: vi.fn().mockResolvedValue(undefined),
      checkPermission: vi.fn(),
    };

    mockDb = {
      apiKeys: {
        findByHash: vi.fn(),
      },
      projects: {
        findById: vi.fn(),
      },
      users: {
        findById: vi.fn(),
      },
    };
  });

  describe('handleNewApiKeyAuth', () => {
    const mockApiKey: ApiKey = {
      id: 'key-123',
      key_hash: 'hash',
      key_prefix: 'bgs_',
      key_suffix: 'abc',
      name: 'Test Key',
      description: null,
      type: 'development',
      status: 'active',
      permission_scope: 'full',
      permissions: ['bugs:read', 'bugs:write'],
      allowed_projects: ['proj-123'],
      allowed_environments: null,
      rate_limit_per_minute: 10,
      rate_limit_per_hour: 100,
      rate_limit_per_day: 1000,
      burst_limit: 5,
      per_endpoint_limits: null,
      ip_whitelist: null,
      allowed_origins: null,
      user_agent_pattern: null,
      expires_at: null,
      rotate_at: null,
      grace_period_days: 7,
      rotated_from: null,
      created_by: 'user-123',
      team_id: null,
      tags: null,
      created_at: new Date(),
      updated_at: new Date(),
      last_used_at: null,
      revoked_at: null,
    };

    it('should authenticate successfully with valid API key', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: mockApiKey });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });
      mockDb.projects.findById.mockResolvedValue({
        id: 'proj-123',
        name: 'Test Project',
      } as Project);

      const result = await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(result).toBe(true);
      expect(mockRequest.apiKey).toEqual(mockApiKey);
      expect(mockRequest.authProject).toBeDefined();
      expect(mockApiKeyService.verifyAndGetKey).toHaveBeenCalledWith('bgs_test_key');
      expect(mockApiKeyService.trackUsage).toHaveBeenCalled();
    });

    it('should return false for invalid API key without sending response', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({
        key: null,
        failureReason: 'not_found',
      });

      const result = await handleNewApiKeyAuth(
        'bgs_invalid_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(result).toBe(false);
      // Should send error response for invalid key
      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid API key',
        })
      );
    });

    it('should check all rate limit windows', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: mockApiKey });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });

      await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'minute', 10);
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'hour', 100);
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'day', 1000);
    });

    it('should reject when rate limit exceeded', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: mockApiKey });
      mockApiKeyService.checkRateLimit
        .mockResolvedValueOnce({ allowed: true, resetAt: new Date(Date.now() + 60000) })
        .mockResolvedValueOnce({
          allowed: false,
          resetAt: new Date(Date.now() + 300000),
        });

      const result = await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(result).toBe(false);
      expect(codeSpy).toHaveBeenCalledWith(429);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'TooManyRequests',
          retryAfter: expect.any(Number),
        })
      );
    });

    it('should check rate limits atomically (increments during check)', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: mockApiKey });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });

      await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      // checkRateLimit atomically increments counters (security: prevents race conditions)
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'minute', 10);
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'hour', 100);
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'day', 1000);
    });

    it('should track usage with correct metadata', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: mockApiKey });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });

      const startTime = Date.now();
      await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        startTime
      );

      expect(mockApiKeyService.trackUsage).toHaveBeenCalledWith(
        'key-123',
        '/api/v1/reports',
        'POST',
        200,
        expect.any(Number), // responseTime
        'test-agent',
        '127.0.0.1'
      );
    });

    it('should load project when allowed_projects specified', async () => {
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: mockApiKey });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });
      const mockProject = { id: 'proj-123', name: 'Test Project' } as Project;
      mockDb.projects.findById.mockResolvedValue(mockProject);

      await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(mockDb.projects.findById).toHaveBeenCalledWith('proj-123');
      expect(mockRequest.authProject).toEqual(mockProject);
    });

    it('should handle API key with no allowed_projects', async () => {
      const keyWithoutProjects = { ...mockApiKey, allowed_projects: [] };
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: keyWithoutProjects });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });

      await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(mockDb.projects.findById).not.toHaveBeenCalled();
      expect(mockRequest.authProject).toBeUndefined();
    });

    it('should use default rate limits when not specified', async () => {
      const keyWithoutLimits = {
        ...mockApiKey,
        rate_limit_per_minute: null,
        rate_limit_per_hour: null,
        rate_limit_per_day: null,
      };
      mockApiKeyService.verifyAndGetKey.mockResolvedValue({ key: keyWithoutLimits });
      mockApiKeyService.checkRateLimit.mockResolvedValue({
        allowed: true,
        resetAt: new Date(Date.now() + 60000),
      });

      await handleNewApiKeyAuth(
        'bgs_test_key',
        mockApiKeyService,
        mockDb,
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        Date.now()
      );

      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'minute', 60);
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'hour', 1000);
      expect(mockApiKeyService.checkRateLimit).toHaveBeenCalledWith('key-123', 'day', 10000);
    });
  });

  describe('handleJwtAuth', () => {
    it('should authenticate successfully with valid JWT', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'admin',
      } as User;

      mockRequest.jwtVerify = vi.fn().mockResolvedValue({ userId: 'user-123' });
      mockDb.users.findById.mockResolvedValue(mockUser);

      const result = await handleJwtAuth(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        mockDb
      );

      expect(result).toBe(true);
      expect(mockRequest.authUser).toEqual(mockUser);
      expect(mockRequest.jwtVerify).toHaveBeenCalled();
      expect(mockDb.users.findById).toHaveBeenCalledWith('user-123');
    });

    it('should reject when user not found in database', async () => {
      mockRequest.jwtVerify = vi.fn().mockResolvedValue({ userId: 'nonexistent' });
      mockDb.users.findById.mockResolvedValue(null);

      const result = await handleJwtAuth(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        mockDb
      );

      expect(result).toBe(false);
      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User not found',
        })
      );
    });

    it('should reject when JWT verification fails', async () => {
      mockRequest.jwtVerify = vi.fn().mockRejectedValue(new Error('Invalid token'));

      const result = await handleJwtAuth(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        mockDb
      );

      expect(result).toBe(false);
      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid or expired token',
        })
      );
    });

    it('should reject when JWT is expired', async () => {
      mockRequest.jwtVerify = vi.fn().mockRejectedValue(new Error('Token expired'));

      const result = await handleJwtAuth(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        mockDb
      );

      expect(result).toBe(false);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('expired'),
        })
      );
    });

    it('should fetch fresh user data from database', async () => {
      // This ensures we don't rely on stale JWT payload data
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'admin',
      } as User;

      mockRequest.jwtVerify = vi.fn().mockResolvedValue({
        userId: 'user-123',
        email: 'old@example.com', // Old email in token
      });
      mockDb.users.findById.mockResolvedValue(mockUser);

      await handleJwtAuth(mockRequest as FastifyRequest, mockReply as FastifyReply, mockDb);

      // Should use fresh data from database, not JWT payload
      expect(mockRequest.authUser).toEqual(mockUser);
      expect(mockRequest.authUser?.email).toBe('test@example.com');
    });
  });
});
