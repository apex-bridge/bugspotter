import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dataResidencyService } from '../../services/data-residency-service';
import { api } from '../../lib/api-client';
import { API_ENDPOINTS } from '../../lib/api-constants';

// Mock the API client
vi.mock('../../lib/api-client', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    api: {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    },
  };
});

describe('dataResidencyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRegions', () => {
    it('should fetch available data residency regions', async () => {
      const mockRegions = [
        {
          id: 'kz',
          name: 'Kazakhstan',
          storageRegions: ['kz-almaty'],
          defaultStorageRegion: 'kz-almaty',
          allowCrossRegionBackup: false,
          allowCrossRegionProcessing: false,
          encryptionRequired: true,
        },
        {
          id: 'global',
          name: 'Global (No Restrictions)',
          storageRegions: ['auto'],
          defaultStorageRegion: 'auto',
          allowCrossRegionBackup: true,
          allowCrossRegionProcessing: true,
          encryptionRequired: false,
        },
      ];

      const mockResponse = {
        data: {
          success: true,
          data: { regions: mockRegions },
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.getRegions();

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.regions());
      expect(result).toEqual(mockRegions);
    });
  });

  describe('getPolicy', () => {
    it('should fetch data residency policy for a project', async () => {
      const projectId = 'project-123';
      const mockPolicyData = {
        projectId,
        policy: {
          region: 'kz' as const,
          storageRegion: 'kz-almaty',
          allowCrossRegionBackup: false,
          allowCrossRegionProcessing: false,
          encryptionRequired: true,
          auditDataAccess: true,
        },
        storageAvailable: true,
        allowedRegions: ['kz-almaty'],
        presets: ['kz', 'rf', 'eu', 'us', 'global'],
      };

      const mockResponse = {
        data: {
          success: true,
          data: mockPolicyData,
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.getPolicy(projectId);

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.getPolicy(projectId));
      expect(result).toEqual(mockPolicyData);
    });
  });

  describe('updatePolicy', () => {
    it('should update data residency policy with region only', async () => {
      const projectId = 'project-123';
      const region = 'eu' as const;
      const mockResponse = {
        data: {
          success: true,
          data: {
            projectId,
            policy: {
              region: 'eu',
              storageRegion: 'eu-central-1',
              allowCrossRegionBackup: false,
              allowCrossRegionProcessing: false,
              encryptionRequired: true,
              auditDataAccess: true,
            },
            storageAvailable: true,
            allowedRegions: ['eu-central-1'],
            presets: ['kz', 'rf', 'eu', 'us', 'global'],
          },
        },
      };

      vi.mocked(api.put).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.updatePolicy(projectId, region);

      expect(api.put).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.updatePolicy(projectId), {
        region,
      });
      expect(result.policy.region).toBe('eu');
    });

    it('should update data residency policy with region and storage region', async () => {
      const projectId = 'project-123';
      const region = 'us' as const;
      const storageRegion = 'us-west-2';
      const mockResponse = {
        data: {
          success: true,
          data: {
            projectId,
            policy: {
              region: 'us',
              storageRegion: 'us-west-2',
              allowCrossRegionBackup: true,
              allowCrossRegionProcessing: true,
              encryptionRequired: false,
              auditDataAccess: false,
            },
            storageAvailable: true,
            allowedRegions: ['us-east-1', 'us-west-2'],
            presets: ['kz', 'rf', 'eu', 'us', 'global'],
          },
        },
      };

      vi.mocked(api.put).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.updatePolicy(projectId, region, storageRegion);

      expect(api.put).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.updatePolicy(projectId), {
        region,
        storageRegion,
      });
      expect(result.policy.region).toBe('us');
      expect(result.policy.storageRegion).toBe('us-west-2');
    });
  });

  describe('getComplianceSummary', () => {
    it('should fetch compliance summary for a project', async () => {
      const projectId = 'project-123';
      const mockSummary = {
        projectId,
        isCompliant: true,
        policy: {
          region: 'kz' as const,
          storageRegion: 'kz-almaty',
          allowCrossRegionBackup: false,
          allowCrossRegionProcessing: false,
          encryptionRequired: true,
          auditDataAccess: true,
        },
        storageAvailable: true,
        violations: {
          count: 0,
          recent: [],
        },
        auditEntries: {
          count: 15,
        },
      };

      const mockResponse = {
        data: {
          success: true,
          data: mockSummary,
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.getComplianceSummary(projectId);

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.compliance(projectId));
      expect(result).toEqual(mockSummary);
      expect(result.isCompliant).toBe(true);
    });

    it('should include violations in compliance summary', async () => {
      const projectId = 'project-123';
      const mockSummary = {
        projectId,
        isCompliant: false,
        policy: {
          region: 'kz' as const,
          storageRegion: 'kz-almaty',
          allowCrossRegionBackup: false,
          allowCrossRegionProcessing: false,
          encryptionRequired: true,
          auditDataAccess: true,
        },
        storageAvailable: true,
        violations: {
          count: 2,
          recent: [
            {
              id: 'violation-1',
              type: 'unauthorized_region_access',
              description: 'Attempted to access data from unauthorized region',
              blocked: true,
              createdAt: '2024-01-15T10:00:00Z',
            },
            {
              id: 'violation-2',
              type: 'cross_region_transfer',
              description: 'Blocked cross-region data transfer',
              blocked: true,
              createdAt: '2024-01-15T09:30:00Z',
            },
          ],
        },
        auditEntries: {
          count: 15,
        },
      };

      const mockResponse = {
        data: {
          success: true,
          data: mockSummary,
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.getComplianceSummary(projectId);

      expect(result.isCompliant).toBe(false);
      expect(result.violations.count).toBe(2);
      expect(result.violations.recent).toHaveLength(2);
    });
  });

  describe('getAuditEntries', () => {
    it('should fetch audit entries with default params', async () => {
      const projectId = 'project-123';
      const mockResponse = {
        data: {
          success: true,
          data: {
            projectId,
            entries: [
              {
                id: 'audit-1',
                action: 'policy_changed',
                resourceType: 'project',
                resourceId: projectId,
                storageRegion: 'kz-almaty',
                userId: 'user-1',
                ipAddress: '192.168.1.1',
                metadata: { oldRegion: 'global', newRegion: 'kz' },
                createdAt: '2024-01-15T10:00:00Z',
              },
            ],
          },
          pagination: {
            page: 1,
            limit: 100,
            total: 1,
            totalPages: 1,
          },
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.getAuditEntries(projectId);

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.audit(projectId), {
        params: {},
      });
      expect(result.data.entries).toHaveLength(1);
    });

    it('should fetch audit entries with query params', async () => {
      const projectId = 'project-123';
      const params = {
        action: 'policy_changed',
        since: '2024-01-01',
        until: '2024-01-31',
        limit: 50,
        offset: 10,
      };

      const mockResponse = {
        data: {
          success: true,
          data: {
            projectId,
            entries: [],
          },
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0,
          },
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await dataResidencyService.getAuditEntries(projectId, params);

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.audit(projectId), {
        params,
      });
    });
  });

  describe('getViolations', () => {
    it('should fetch violations with default params', async () => {
      const projectId = 'project-123';
      const mockResponse = {
        data: {
          success: true,
          data: {
            projectId,
            violations: [
              {
                id: 'violation-1',
                type: 'unauthorized_region_access',
                description: 'Attempted to access data from unauthorized region',
                attemptedAction: 'read',
                sourceRegion: 'us-east-1',
                targetRegion: 'kz-almaty',
                blocked: true,
                userId: 'user-1',
                createdAt: '2024-01-15T10:00:00Z',
              },
            ],
          },
          pagination: {
            page: 1,
            limit: 100,
            total: 1,
            totalPages: 1,
          },
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      const result = await dataResidencyService.getViolations(projectId);

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.violations(projectId), {
        params: {},
      });
      expect(result.data.violations).toHaveLength(1);
    });

    it('should fetch violations with filters', async () => {
      const projectId = 'project-123';
      const params = {
        violationType: 'cross_region_transfer',
        blocked: true,
        since: '2024-01-01',
        until: '2024-01-31',
        limit: 25,
        offset: 0,
      };

      const mockResponse = {
        data: {
          success: true,
          data: {
            projectId,
            violations: [],
          },
          pagination: {
            page: 1,
            limit: 25,
            total: 0,
            totalPages: 0,
          },
        },
      };

      vi.mocked(api.get).mockResolvedValue(mockResponse);

      await dataResidencyService.getViolations(projectId, params);

      expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.dataResidency.violations(projectId), {
        params,
      });
    });
  });
});
