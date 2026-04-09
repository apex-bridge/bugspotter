/**
 * Unit tests for bug report access control utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAccessFilters,
  validateProjectAccess,
} from '../../../src/api/utils/bug-report-access.js';
import type { User, Project } from '../../../src/db/types.js';
import type { DatabaseClient } from '../../../src/db/client.js';

describe('buildAccessFilters', () => {
  const mockUser: User = {
    id: 'user-123',
    email: 'user@example.com',
    password_hash: 'hash',
    role: 'user',
    name: 'Test User',
    oauth_provider: null,
    oauth_id: null,
    created_at: new Date(),
  };

  const mockAdmin: User = {
    ...mockUser,
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin',
  };

  const mockProject: Project = {
    id: 'proj-123',
    name: 'Test Project',
    settings: {},
    created_by: 'user-123',
    created_at: new Date(),
    updated_at: new Date(),
  };

  describe('API key authentication (authProject)', () => {
    it('should restrict to project only when using API key', () => {
      const result = buildAccessFilters(undefined, mockProject, undefined, {
        status: 'open',
        priority: 'high',
      });

      expect(result).toEqual({
        filters: {
          project_id: 'proj-123',
          status: 'open',
          priority: 'high',
        },
        requiresValidation: false,
      });
    });

    it('should ignore requested project_id when using API key', () => {
      const result = buildAccessFilters(undefined, mockProject, 'different-proj-id', {
        status: 'open',
      });

      expect(result.filters.project_id).toBe('proj-123'); // Uses authProject, not requested
      expect(result.filters.status).toBe('open');
    });

    it('should work without additional filters', () => {
      const result = buildAccessFilters(undefined, mockProject, undefined, {});

      expect(result).toEqual({
        filters: {
          project_id: 'proj-123',
        },
        requiresValidation: false,
      });
    });
  });

  describe('Admin authentication', () => {
    it('should allow access to all projects when no project_id specified', () => {
      const result = buildAccessFilters(mockAdmin, undefined, undefined, {
        status: 'resolved',
      });

      expect(result).toEqual({
        filters: {
          status: 'resolved',
        },
        requiresValidation: false,
      });
      expect(result.filters).not.toHaveProperty('project_id');
    });

    it('should filter by specific project when admin requests it', () => {
      const result = buildAccessFilters(mockAdmin, undefined, 'proj-abc', {
        priority: 'critical',
      });

      expect(result).toEqual({
        filters: {
          project_id: 'proj-abc',
          priority: 'critical',
        },
        requiresValidation: false,
      });
    });

    it('should work with date filters', () => {
      const createdAfter = new Date('2024-01-01');
      const createdBefore = new Date('2024-12-31');

      const result = buildAccessFilters(mockAdmin, undefined, 'proj-123', {
        created_after: createdAfter,
        created_before: createdBefore,
      });

      expect(result.filters.created_after).toBe(createdAfter);
      expect(result.filters.created_before).toBe(createdBefore);
    });
  });

  describe('Regular user with specific project_id', () => {
    it('should require validation when user requests specific project', () => {
      const result = buildAccessFilters(mockUser, undefined, 'proj-456', {
        status: 'open',
      });

      expect(result).toEqual({
        filters: {
          project_id: 'proj-456',
          status: 'open',
        },
        requiresValidation: true,
      });
    });

    it('should preserve all filters for validation scenario', () => {
      const result = buildAccessFilters(mockUser, undefined, 'proj-789', {
        status: 'resolved',
        priority: 'low',
        created_after: new Date(),
      });

      expect(result.requiresValidation).toBe(true);
      expect(result.filters.project_id).toBe('proj-789');
      expect(result.filters.status).toBe('resolved');
      expect(result.filters.priority).toBe('low');
      expect(result.filters.created_after).toBeInstanceOf(Date);
    });
  });

  describe('Regular user without specific project_id (optimized JOIN)', () => {
    it('should use user_id filter for optimized JOIN query', () => {
      const result = buildAccessFilters(mockUser, undefined, undefined, {
        priority: 'medium',
      });

      expect(result).toEqual({
        filters: {
          user_id: 'user-123',
          priority: 'medium',
        },
        requiresValidation: false,
      });
      expect(result.filters).not.toHaveProperty('project_id');
    });

    it('should work without additional filters', () => {
      const result = buildAccessFilters(mockUser, undefined, undefined, {});

      expect(result).toEqual({
        filters: {
          user_id: 'user-123',
        },
        requiresValidation: false,
      });
    });
  });

  describe('No authentication', () => {
    it('should throw 401 Unauthorized error', () => {
      expect(() => {
        buildAccessFilters(undefined, undefined, undefined, {});
      }).toThrow('Authentication required');

      expect(() => {
        buildAccessFilters(undefined, undefined, 'proj-123', {});
      }).toThrow('Authentication required');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined additional filters', () => {
      const result = buildAccessFilters(mockUser, undefined, undefined);

      expect(result.filters.user_id).toBe('user-123');
      expect(result.requiresValidation).toBe(false);
    });

    it('should handle empty string project_id as falsy', () => {
      const result = buildAccessFilters(mockUser, undefined, '', {});

      // Empty string is falsy, should use user_id path
      expect(result.filters.user_id).toBe('user-123');
      expect(result.requiresValidation).toBe(false);
    });
  });
});

describe('validateProjectAccess', () => {
  let mockDb: DatabaseClient;

  beforeEach(() => {
    mockDb = {
      projects: {
        hasAccess: vi.fn(),
      },
    } as unknown as DatabaseClient;
  });

  it('should not throw when user has access to project', async () => {
    vi.mocked(mockDb.projects.hasAccess).mockResolvedValue(true);

    await expect(validateProjectAccess('proj-123', 'user-456', mockDb)).resolves.not.toThrow();

    expect(mockDb.projects.hasAccess).toHaveBeenCalledWith('proj-123', 'user-456');
  });

  it('should throw 403 Forbidden when user does not have access', async () => {
    vi.mocked(mockDb.projects.hasAccess).mockResolvedValue(false);

    await expect(validateProjectAccess('proj-123', 'user-789', mockDb)).rejects.toThrow(
      'Access denied to project'
    );

    expect(mockDb.projects.hasAccess).toHaveBeenCalledWith('proj-123', 'user-789');
  });

  it('should propagate database errors', async () => {
    const dbError = new Error('Database connection failed');
    vi.mocked(mockDb.projects.hasAccess).mockRejectedValue(dbError);

    await expect(validateProjectAccess('proj-123', 'user-999', mockDb)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
