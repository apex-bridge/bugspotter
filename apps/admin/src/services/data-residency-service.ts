/**
 * Data Residency Service
 *
 * Service for managing data residency policies and compliance
 */

import { api } from '../lib/api-client';
import { API_ENDPOINTS } from '../lib/api-constants';

export type DataResidencyRegion = 'kz' | 'rf' | 'eu' | 'us' | 'global';
export type StorageRegion = string;

/**
 * Regions that require strict data residency compliance
 * (matches backend STRICT_DATA_RESIDENCY_REGIONS)
 */
export const STRICT_REGIONS: ReadonlySet<DataResidencyRegion> = new Set(['kz', 'rf']);

export interface DataResidencyPolicy {
  region: DataResidencyRegion;
  storageRegion: StorageRegion;
  allowCrossRegionBackup: boolean;
  allowCrossRegionProcessing: boolean;
  encryptionRequired: boolean;
  auditDataAccess: boolean;
}

export interface RegionInfo {
  id: DataResidencyRegion;
  name: string;
  storageRegions: StorageRegion[];
  defaultStorageRegion: StorageRegion;
  allowCrossRegionBackup: boolean;
  allowCrossRegionProcessing: boolean;
  encryptionRequired: boolean;
}

export interface DataResidencyResponse {
  projectId: string;
  policy: DataResidencyPolicy;
  storageAvailable: boolean;
  allowedRegions: StorageRegion[];
  presets: string[];
}

export interface ComplianceSummary {
  projectId: string;
  isCompliant: boolean;
  policy: DataResidencyPolicy;
  storageAvailable: boolean;
  violations: {
    count: number;
    recent: ViolationEntry[];
  };
  auditEntries: {
    count: number;
  };
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  storageRegion: string;
  userId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ViolationEntry {
  id: string;
  type: string;
  description: string;
  attemptedAction?: string;
  sourceRegion?: string | null;
  targetRegion?: string | null;
  blocked: boolean;
  userId?: string | null;
  createdAt: string;
}

export interface AuditQueryParams {
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface ViolationQueryParams {
  violationType?: string;
  blocked?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Data Residency Service
 */
export const dataResidencyService = {
  /**
   * Get available data residency regions
   */
  getRegions: async (): Promise<RegionInfo[]> => {
    const response = await api.get<{ success: boolean; data: { regions: RegionInfo[] } }>(
      API_ENDPOINTS.dataResidency.regions()
    );
    return response.data.data.regions;
  },

  /**
   * Get data residency policy for a project
   */
  getPolicy: async (projectId: string): Promise<DataResidencyResponse> => {
    const response = await api.get<{ success: boolean; data: DataResidencyResponse }>(
      API_ENDPOINTS.dataResidency.getPolicy(projectId)
    );
    return response.data.data;
  },

  /**
   * Update data residency policy for a project
   */
  updatePolicy: async (
    projectId: string,
    region: DataResidencyRegion,
    storageRegion?: StorageRegion
  ): Promise<DataResidencyResponse> => {
    const response = await api.put<{ success: boolean; data: DataResidencyResponse }>(
      API_ENDPOINTS.dataResidency.updatePolicy(projectId),
      { region, ...(storageRegion && { storageRegion }) }
    );
    return response.data.data;
  },

  /**
   * Get compliance summary for a project
   */
  getComplianceSummary: async (projectId: string): Promise<ComplianceSummary> => {
    const response = await api.get<{ success: boolean; data: ComplianceSummary }>(
      API_ENDPOINTS.dataResidency.compliance(projectId)
    );
    return response.data.data;
  },

  /**
   * Get audit log entries for a project
   */
  getAuditEntries: async (
    projectId: string,
    params: AuditQueryParams = {}
  ): Promise<PaginatedResponse<{ projectId: string; entries: AuditEntry[] }>> => {
    const response = await api.get<PaginatedResponse<{ projectId: string; entries: AuditEntry[] }>>(
      API_ENDPOINTS.dataResidency.audit(projectId),
      { params }
    );
    return response.data;
  },

  /**
   * Get violations for a project
   */
  getViolations: async (
    projectId: string,
    params: ViolationQueryParams = {}
  ): Promise<PaginatedResponse<{ projectId: string; violations: ViolationEntry[] }>> => {
    const response = await api.get<
      PaginatedResponse<{ projectId: string; violations: ViolationEntry[] }>
    >(API_ENDPOINTS.dataResidency.violations(projectId), { params });
    return response.data;
  },
};
