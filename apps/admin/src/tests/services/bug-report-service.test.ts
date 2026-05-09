import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bugReportService } from '../../services/api';
import { api } from '../../lib/api-client';
import type { BugReportFilters, BugStatus, BugPriority } from '../../types';

// Mock the api client
vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    handleApiError: vi.fn((error) => error.message),
  };
});

describe('bugReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('fetches bug reports with default parameters', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await bugReportService.getAll();

      // Service now uses axios `params` option (gemini's review on
      // PR #118 — consistency with project/user services). Inspect
      // the params object instead of the serialized URL string.
      expect(api.get).toHaveBeenCalledWith('/api/v1/reports', {
        params: { page: 1, limit: 20, sort_by: 'created_at', order: 'desc' },
      });
    });

    it('includes filters in query params', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const filters: BugReportFilters = {
        project_id: 'project-123',
        status: 'open',
        priority: 'high',
        created_after: '2024-01-01',
        created_before: '2024-12-31',
      };

      await bugReportService.getAll(filters);

      const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
      expect(params.project_id).toBe('project-123');
      expect(params.status).toBe('open');
      expect(params.priority).toBe('high');
      expect(params.created_after).toBe('2024-01-01');
      expect(params.created_before).toBe('2024-12-31');
    });

    it('supports custom pagination', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: { page: 2, limit: 50, total: 100, totalPages: 2 },
        },
      };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await bugReportService.getAll({}, 2, 50);

      const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
      expect(params.page).toBe(2);
      expect(params.limit).toBe(50);
    });

    it('supports custom sorting', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await bugReportService.getAll({}, 1, 20, 'priority', 'asc');

      const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
      expect(params.sort_by).toBe('priority');
      expect(params.order).toBe('asc');
    });

    it('serialises organizationId as `organization_id` for the wire', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await bugReportService.getAll(undefined, 1, 20, 'created_at', 'desc', 'org-123');

      const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
      expect(params.organization_id).toBe('org-123');
      expect(params).not.toHaveProperty('organizationId');
    });

    it('omits organization_id when no scope is passed', async () => {
      const mockResponse = {
        data: {
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await bugReportService.getAll();

      const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
      expect(params).not.toHaveProperty('organization_id');
    });
  });

  describe('getById', () => {
    it('fetches a single bug report by ID', async () => {
      const mockReport = {
        id: 'report-123',
        project_id: 'project-1',
        title: 'Test Bug',
        status: 'open' as BugStatus,
        priority: 'medium' as BugPriority,
        description: null,
        screenshot_url: null,
        replay_url: null,
        metadata: {},
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const mockResponse = { data: { data: mockReport } };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await bugReportService.getById('report-123');

      expect(api.get).toHaveBeenCalledWith('/api/v1/reports/report-123');
      expect(result).toEqual(mockReport);
    });
  });

  describe('update', () => {
    it('updates bug report status', async () => {
      const mockReport = {
        id: 'report-123',
        status: 'resolved' as BugStatus,
      };
      const mockResponse = { data: { data: mockReport } };
      vi.mocked(api.patch).mockResolvedValue(mockResponse);

      await bugReportService.update('report-123', { status: 'resolved' });

      expect(api.patch).toHaveBeenCalledWith('/api/v1/reports/report-123', {
        status: 'resolved',
      });
    });

    it('updates bug report priority', async () => {
      const mockReport = {
        id: 'report-123',
        priority: 'critical' as BugPriority,
      };
      const mockResponse = { data: { data: mockReport } };
      vi.mocked(api.patch).mockResolvedValue(mockResponse);

      await bugReportService.update('report-123', { priority: 'critical' });

      expect(api.patch).toHaveBeenCalledWith('/api/v1/reports/report-123', {
        priority: 'critical',
      });
    });

    it('updates multiple fields', async () => {
      const mockReport = {
        id: 'report-123',
        status: 'in-progress' as BugStatus,
        priority: 'high' as BugPriority,
        description: 'Updated description',
      };
      const mockResponse = { data: { data: mockReport } };
      vi.mocked(api.patch).mockResolvedValue(mockResponse);

      await bugReportService.update('report-123', {
        status: 'in-progress',
        priority: 'high',
        description: 'Updated description',
      });

      expect(api.patch).toHaveBeenCalledWith('/api/v1/reports/report-123', {
        status: 'in-progress',
        priority: 'high',
        description: 'Updated description',
      });
    });
  });

  describe('delete', () => {
    it('deletes a bug report', async () => {
      vi.mocked(api.delete).mockResolvedValue({});

      await bugReportService.delete('report-123');

      expect(api.delete).toHaveBeenCalledWith('/api/v1/reports/report-123');
    });
  });

  describe('bulkDelete', () => {
    it('deletes multiple bug reports', async () => {
      vi.mocked(api.post).mockResolvedValue({});

      const ids = ['report-1', 'report-2', 'report-3'];
      await bugReportService.bulkDelete(ids);

      expect(api.post).toHaveBeenCalledWith('/api/v1/reports/bulk-delete', { ids });
    });
  });

  describe('getSessions', () => {
    it('fetches sessions for a bug report', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          bug_report_id: 'report-123',
          events: { type: 'rrweb', recordedEvents: [] },
          duration: 5000,
          created_at: '2024-01-01T00:00:00Z',
        },
      ];
      const mockResponse = { data: { data: mockSessions } };
      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await bugReportService.getSessions('report-123');

      expect(api.get).toHaveBeenCalledWith('/api/v1/reports/report-123/sessions');
      expect(result).toEqual(mockSessions);
    });
  });
});
