/**
 * Authentication Helper Functions Tests
 * Tests for requireApiKey, requireUser, requireProject, requireRole
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requireApiKey, requireUser, requireProject } from '../../src/api/middleware/auth.js';
import { requireRole } from '../../src/api/middleware/auth/authorization.js';
import type { ApiKey, User, Project } from '../../src/db/types.js';

describe('Authentication Helper Functions', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  let codeSpy: ReturnType<typeof vi.fn>;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    codeSpy = vi.fn(() => ({ send: sendSpy }));

    mockRequest = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };

    mockReply = {
      code: codeSpy as any,
      send: sendSpy,
    };
  });

  describe('requireApiKey', () => {
    it('should pass when API key is present', async () => {
      mockRequest.apiKey = {
        id: 'key-123',
      } as ApiKey;

      const result = await requireApiKey(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(result).toBeUndefined();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('should reject when API key is not present', async () => {
      mockRequest.apiKey = undefined;

      await requireApiKey(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Unauthorized',
          message: 'API key required (X-API-Key header)',
        })
      );
    });
  });

  describe('requireUser', () => {
    it('should pass when user is authenticated', async () => {
      mockRequest.authUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'user',
      } as User;

      const result = await requireUser(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(result).toBeUndefined();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('should reject when user is not authenticated', async () => {
      mockRequest.authUser = undefined;

      await requireUser(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Unauthorized',
          message: 'User authentication required (Authorization Bearer token)',
        })
      );
    });
  });

  describe('requireProject', () => {
    it('should pass when project is authenticated', async () => {
      mockRequest.authProject = {
        id: 'proj-123',
        name: 'Test Project',
      } as Project;

      const result = await requireProject(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(result).toBeUndefined();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('should reject when project is not authenticated', async () => {
      mockRequest.authProject = undefined;

      await requireProject(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Unauthorized',
          message: 'Project API key required (X-API-Key header)',
        })
      );
    });
  });

  describe('requireRole', () => {
    it('should pass when user has required role', async () => {
      mockRequest.authUser = {
        id: 'user-123',
        email: 'admin@example.com',
        role: 'admin',
      } as User;

      const middleware = requireRole('admin');
      const result = await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(result).toBeUndefined();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('should pass when user has one of multiple allowed roles', async () => {
      mockRequest.authUser = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'user',
      } as User;

      const middleware = requireRole('admin', 'user');
      const result = await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(result).toBeUndefined();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('should reject when user does not have required role', async () => {
      mockRequest.authUser = {
        id: 'user-123',
        email: 'viewer@example.com',
        role: 'viewer',
      } as User;

      const middleware = requireRole('admin');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(codeSpy).toHaveBeenCalledWith(403);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Forbidden',
          message: 'Insufficient permissions. Required role: admin',
        })
      );
    });

    it('should reject when user is not authenticated', async () => {
      mockRequest.authUser = undefined;

      const middleware = requireRole('admin');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(codeSpy).toHaveBeenCalledWith(401);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Unauthorized',
          message: 'User authentication required',
        })
      );
    });

    it('should show multiple allowed roles in error message', async () => {
      mockRequest.authUser = {
        id: 'user-123',
        email: 'viewer@example.com',
        role: 'viewer',
      } as User;

      const middleware = requireRole('admin', 'user');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('admin or user'),
        })
      );
    });
  });
});
