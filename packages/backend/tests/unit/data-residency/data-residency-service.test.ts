import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataResidencyService } from '../../../src/data-residency/data-residency-service.js';
import type { DataResidencyRepository } from '../../../src/db/repositories/data-residency.repository.js';
import type { DataResidencyPolicy, StorageRegion } from '../../../src/data-residency/types.js';
import type {
  DataResidencyViolationRow,
  DataResidencyAuditRow,
} from '../../../src/db/repositories/data-residency.repository.js';
import * as config from '../../../src/data-residency/config.js';

// Mock configuration module
vi.mock('../../../src/data-residency/config.js', () => ({
  validateStorageRegion: vi.fn(() => ({ valid: true })),
  isRegionAvailable: vi.fn(() => true),
  getDefaultStorageRegionFor: vi.fn((region) => {
    if (region === 'eu') {
      return 'eu-west-1';
    }
    return 'auto';
  }),
  getRegionalStorageConfig: vi.fn(() => ({})),
  getDataResidencyPolicy: vi.fn((region) => ({
    region: region || 'global',
    storageRegion: 'auto',
    allowCrossRegionBackup: true,
    allowCrossRegionProcessing: true,
    encryptionRequired: false,
    auditDataAccess: false,
  })),
  ALLOWED_STORAGE_REGIONS: {
    global: ['auto', 'us-east-1', 'eu-west-1'],
    eu: ['eu-west-1', 'eu-central-1'],
    us: ['us-east-1', 'us-west-2'],
    kz: ['kz-almaty'],
    rf: ['rf-moscow'],
  },
  DataResidencyPolicySchema: {
    safeParse: () => ({ success: true }),
  },
}));

describe('DataResidencyService', () => {
  let service: DataResidencyService;
  let mockRepository: {
    getProjectPolicy: ReturnType<typeof vi.fn>;
    updateProjectPolicy: ReturnType<typeof vi.fn>;
    insertViolation: ReturnType<typeof vi.fn>;
    getProjectViolations: ReturnType<typeof vi.fn>;
    insertAuditEntry: ReturnType<typeof vi.fn>;
    getProjectAuditEntries: ReturnType<typeof vi.fn>;
    getComplianceSummary: ReturnType<typeof vi.fn>;
    pool: unknown;
    getClient: () => unknown;
  };

  const mockPolicy: DataResidencyPolicy = {
    region: 'eu',
    storageRegion: 'eu-west-1',
    allowCrossRegionBackup: false,
    allowCrossRegionProcessing: false,
    encryptionRequired: true,
    auditDataAccess: true,
  };

  beforeEach(() => {
    mockRepository = {
      getProjectPolicy: vi.fn(),
      updateProjectPolicy: vi.fn(),
      insertViolation: vi.fn(),
      getProjectViolations: vi.fn(),
      insertAuditEntry: vi.fn(),
      getProjectAuditEntries: vi.fn(),
      getComplianceSummary: vi.fn(),
      pool: {},
      getClient: vi.fn(),
    };

    service = new DataResidencyService(mockRepository as unknown as DataResidencyRepository);
  });

  describe('getProjectPolicy', () => {
    it('should delegate to repository', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(mockPolicy);

      const result = await service.getProjectPolicy('project-123');

      expect(result).toEqual(mockPolicy);
      expect(mockRepository.getProjectPolicy).toHaveBeenCalledWith('project-123');
    });

    it('should return default policy when repository returns null', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(null);

      const result = await service.getProjectPolicy('project-123');

      expect(result.region).toBe('global');
      expect(result.storageRegion).toBe('auto');
    });
  });

  describe('setProjectPolicy', () => {
    it('should update policy via repository and create audit entry', async () => {
      const newPolicy: DataResidencyPolicy = {
        region: 'us',
        storageRegion: 'us-east-1',
        allowCrossRegionBackup: false,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: true,
      };

      mockRepository.updateProjectPolicy.mockResolvedValue(undefined);
      mockRepository.insertAuditEntry.mockResolvedValue({
        id: 'audit-123',
        project_id: 'project-123',
        action: 'policy_changed',
        resource_type: 'project',
        resource_id: 'project-123',
        storage_region: 'us-east-1',
        created_at: new Date(),
        user_id: null,
        ip_address: null,
        metadata: null,
      } as DataResidencyAuditRow);

      await service.setProjectPolicy('project-123', newPolicy, 'user-456');

      expect(mockRepository.updateProjectPolicy).toHaveBeenCalledWith(
        'project-123',
        'us',
        'us-east-1'
      );
      expect(mockRepository.insertAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'project-123',
          action: 'policy_changed',
        })
      );
    });

    it('should throw on invalid storage region for data residency region', async () => {
      vi.mocked(config.validateStorageRegion).mockReturnValueOnce({
        valid: false,
        error: 'Invalid storage region',
      });

      const invalidPolicy: DataResidencyPolicy = {
        region: 'eu',
        storageRegion: 'us-east-1', // US region not allowed for EU data residency
        allowCrossRegionBackup: false,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: false,
      };

      await expect(service.setProjectPolicy('project-123', invalidPolicy)).rejects.toThrow();
    });
  });

  describe('validateStorageOperation', () => {
    it('should allow operation when target region is allowed', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(mockPolicy);

      const result = await service.validateStorageOperation('project-123', 'create', 'eu-west-1');

      expect(result.allowed).toBe(true);
      expect(result.targetRegion).toBe('eu-west-1');
    });

    it('should block operation when target region is not allowed', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(mockPolicy);
      mockRepository.insertViolation.mockResolvedValue({
        id: 'violation-123',
        project_id: 'project-123',
        violation_type: 'storage_region_mismatch',
        description: 'blocked',
        attempted_action: 'create',
        blocked: true,
        created_at: new Date(),
        user_id: null,
        source_region: null,
        target_region: 'us-east-1',
      } as DataResidencyViolationRow);

      const result = await service.validateStorageOperation(
        'project-123',
        'create',
        'us-east-1' as StorageRegion
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should use policy storage region when no target specified', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(mockPolicy);

      const result = await service.validateStorageOperation('project-123', 'create');

      expect(result.allowed).toBe(true);
      expect(result.targetRegion).toBe('eu-west-1');
    });
  });

  describe('validateCrossRegionTransfer', () => {
    const strictPolicy: DataResidencyPolicy = {
      region: 'kz',
      storageRegion: 'auto',
      allowCrossRegionBackup: false,
      allowCrossRegionProcessing: false,
      encryptionRequired: true,
      auditDataAccess: true,
    };

    it('should allow transfer within same region', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(strictPolicy);

      const result = await service.validateCrossRegionTransfer(
        'project-123',
        'eu-west-1',
        'eu-west-1'
      );

      expect(result.allowed).toBe(true);
    });

    it('should block cross-region transfer when policy disallows it', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(strictPolicy);
      mockRepository.insertViolation.mockResolvedValue({
        id: 'violation-123',
        project_id: 'project-123',
        violation_type: 'cross_region_transfer',
        description: 'blocked',
        attempted_action: 'transfer',
        blocked: true,
        created_at: new Date(),
        user_id: null,
        source_region: 'us-east-1',
        target_region: 'eu-west-1',
      } as DataResidencyViolationRow);

      const result = await service.validateCrossRegionTransfer(
        'project-123',
        'us-east-1',
        'eu-west-1'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });
  });

  describe('getProjectStorageConfig', () => {
    it('should return storage config for policy region', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(mockPolicy);

      const config = await service.getProjectStorageConfig('project-123');

      // For 'eu' region with 'auto' storage, it would return null (use default)
      // For explicit region, it would return regional config
      expect(config).toBeDefined();
    });
  });

  describe('recordViolation', () => {
    it('should insert violation via repository', async () => {
      const mockViolationRow: DataResidencyViolationRow = {
        id: 'violation-123',
        project_id: 'project-123',
        violation_type: 'storage_region_mismatch',
        description: 'Test violation',
        attempted_action: 'create',
        blocked: true,
        created_at: new Date(),
        user_id: null,
        source_region: null,
        target_region: 'us-east-1',
      };

      mockRepository.insertViolation.mockResolvedValue(mockViolationRow);

      const result = await service.recordViolation({
        projectId: 'project-123',
        violationType: 'storage_region_mismatch',
        description: 'Test violation',
        attemptedAction: 'create',
        blocked: true,
        targetRegion: 'us-east-1',
      });

      expect(result.id).toBe('violation-123');
      expect(result.projectId).toBe('project-123');
      expect(mockRepository.insertViolation).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'project-123',
          violation_type: 'storage_region_mismatch',
        })
      );
    });
  });

  describe('auditDataAccess', () => {
    it('should insert audit entry when policy requires auditing', async () => {
      mockRepository.getProjectPolicy.mockResolvedValue(mockPolicy); // auditDataAccess: true
      mockRepository.insertAuditEntry.mockResolvedValue({
        id: 'audit-123',
        project_id: 'project-123',
        action: 'data_created',
        resource_type: 'bug_report',
        resource_id: 'bug-456',
        storage_region: 'eu-west-1',
        created_at: new Date(),
        user_id: null,
        ip_address: null,
        metadata: null,
      } as DataResidencyAuditRow);

      const result = await service.auditDataAccess({
        projectId: 'project-123',
        action: 'data_created',
        resourceType: 'bug_report',
        resourceId: 'bug-456',
        storageRegion: 'eu-west-1',
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('audit-123');
      expect(mockRepository.insertAuditEntry).toHaveBeenCalled();
    });

    it('should return null when policy disables auditing', async () => {
      const noAuditPolicy: DataResidencyPolicy = {
        region: 'global',
        storageRegion: 'auto',
        allowCrossRegionBackup: true,
        allowCrossRegionProcessing: true,
        encryptionRequired: false,
        auditDataAccess: false,
      };

      mockRepository.getProjectPolicy.mockResolvedValue(noAuditPolicy);

      const result = await service.auditDataAccess({
        projectId: 'project-123',
        action: 'data_read',
        resourceType: 'bug_report',
        resourceId: 'bug-456',
        storageRegion: 'eu-west-1',
      });

      expect(result).toBeNull(); // No audit entry created
      expect(mockRepository.insertAuditEntry).not.toHaveBeenCalled();
    });

    it('should always audit policy_changed action', async () => {
      const noAuditPolicy: DataResidencyPolicy = {
        region: 'global',
        storageRegion: 'auto',
        allowCrossRegionBackup: true,
        allowCrossRegionProcessing: true,
        encryptionRequired: false,
        auditDataAccess: false,
      };

      mockRepository.getProjectPolicy.mockResolvedValue(noAuditPolicy);
      mockRepository.insertAuditEntry.mockResolvedValue({
        id: 'audit-123',
        project_id: 'project-123',
        action: 'policy_changed',
        resource_type: 'project',
        resource_id: 'project-123',
        storage_region: 'auto',
        created_at: new Date(),
        user_id: null,
        ip_address: null,
        metadata: null,
      } as DataResidencyAuditRow);

      const result = await service.auditDataAccess({
        projectId: 'project-123',
        action: 'policy_changed',
        resourceType: 'project',
        resourceId: 'project-123',
        storageRegion: 'auto',
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('audit-123');
      expect(mockRepository.insertAuditEntry).toHaveBeenCalled();
    });
  });

  describe('getProjectViolations', () => {
    it('should delegate to repository and map results', async () => {
      const mockViolations: DataResidencyViolationRow[] = [
        {
          id: 'v1',
          project_id: 'project-123',
          violation_type: 'storage_region_mismatch',
          description: 'Test',
          attempted_action: 'create',
          blocked: true,
          created_at: new Date(),
          user_id: null,
          source_region: null,
          target_region: 'us-east-1',
        },
      ];

      mockRepository.getProjectViolations.mockResolvedValue(mockViolations);

      const result = await service.getProjectViolations('project-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('v1');
      expect(mockRepository.getProjectViolations).toHaveBeenCalledWith('project-123', undefined);
    });
  });

  describe('getProjectAuditEntries', () => {
    it('should delegate to repository and map results', async () => {
      const mockEntries: DataResidencyAuditRow[] = [
        {
          id: 'a1',
          project_id: 'project-123',
          action: 'data_created',
          resource_type: 'bug_report',
          resource_id: 'bug-456',
          storage_region: 'eu-west-1',
          created_at: new Date(),
          user_id: null,
          ip_address: null,
          metadata: null,
        },
      ];

      mockRepository.getProjectAuditEntries.mockResolvedValue(mockEntries);

      const result = await service.getProjectAuditEntries('project-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a1');
    });
  });

  describe('hasStrictResidency', () => {
    it('should return true for Kazakhstan region', async () => {
      const kzPolicy: DataResidencyPolicy = {
        region: 'kz',
        storageRegion: 'auto',
        allowCrossRegionBackup: false,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: true,
      };

      mockRepository.getProjectPolicy.mockResolvedValue(kzPolicy);

      const result = await service.hasStrictResidency('project-123');

      expect(result).toBe(true);
    });

    it('should return false for global region', async () => {
      const globalPolicy: DataResidencyPolicy = {
        region: 'global',
        storageRegion: 'auto',
        allowCrossRegionBackup: true,
        allowCrossRegionProcessing: true,
        encryptionRequired: false,
        auditDataAccess: false,
      };

      mockRepository.getProjectPolicy.mockResolvedValue(globalPolicy);

      const result = await service.hasStrictResidency('project-123');

      expect(result).toBe(false);
    });
  });

  describe('getComplianceSummary', () => {
    it('should delegate to repository', async () => {
      const mockSummary = {
        policy: mockPolicy,
        violationCount: 0,
        recentViolations: [],
        auditCount: 5,
      };

      mockRepository.getComplianceSummary.mockResolvedValue(mockSummary);

      const result = await service.getComplianceSummary('project-123');

      expect(result.isCompliant).toBe(true);
      expect(result.storageConfigured).toBe(true);
      expect(result.auditCount).toBe(5);
      expect(mockRepository.getComplianceSummary).toHaveBeenCalledWith('project-123');
    });
  });
});
