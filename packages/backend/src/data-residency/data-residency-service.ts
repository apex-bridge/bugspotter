/**
 * Data Residency Service
 *
 * Enforces data residency policies for projects:
 * - Validates storage operations against region policies
 * - Routes uploads to correct regional storage
 * - Audits data access for compliance
 * - Blocks unauthorized cross-region transfers
 */

import { getLogger } from '../logger.js';
import { ValidationError } from '../api/middleware/error.js';
import type {
  DataResidencyRepository,
  AuditQueryOptions,
  ViolationQueryOptions,
} from '../db/repositories/data-residency.repository.js';
import type {
  StorageRegion,
  DataResidencyPolicy,
  DataResidencyValidationResult,
  DataResidencyViolation,
  DataResidencyAuditEntry,
  DataResidencyRegion,
} from './types.js';
import {
  ALLOWED_STORAGE_REGIONS,
  STRICT_DATA_RESIDENCY_REGIONS,
  DataResidencyPolicySchema,
} from './types.js';
import {
  getRegionalStorageConfig,
  isRegionAvailable,
  getDefaultStorageRegionFor,
  validateStorageRegion,
  getDataResidencyPolicy,
} from './config.js';

const logger = getLogger();

/**
 * Data Residency Service
 * Manages data residency compliance using database-backed storage
 */
export class DataResidencyService {
  constructor(private readonly repository: DataResidencyRepository) {
    logger.debug('Data residency service initialized');
  }

  /**
   * Check if a data residency region requires strict compliance
   * @private
   */
  private static isStrictRegion(region: string): boolean {
    // No type assertion needed - Set.has() accepts any value and returns false for invalid entries
    return STRICT_DATA_RESIDENCY_REGIONS.has(region as DataResidencyRegion);
  }

  /**
   * Set data residency policy for a project
   */
  async setProjectPolicy(
    projectId: string,
    policy: DataResidencyPolicy,
    userId?: string
  ): Promise<void> {
    // Validate policy
    const parsed = DataResidencyPolicySchema.safeParse(policy);
    if (!parsed.success) {
      throw new Error(`Invalid data residency policy: ${parsed.error.message}`);
    }

    // Validate storage region is allowed for the data residency region
    const validation = validateStorageRegion(policy.storageRegion, policy.region);
    if (!validation.valid) {
      // Distinguish between user input errors (400) and system errors (500)
      if (validation.error?.includes('not allowed')) {
        // User provided incompatible regions - validation error
        throw new ValidationError(validation.error);
      } else {
        // System configuration issue - server error
        throw new Error(validation.error);
      }
    }

    // Update in database
    await this.repository.updateProjectPolicy(projectId, policy.region, policy.storageRegion);

    // Audit the policy change
    await this.auditDataAccess({
      projectId,
      action: 'policy_changed',
      resourceType: 'project',
      resourceId: projectId,
      storageRegion: policy.storageRegion,
      userId,
    });

    logger.info('Data residency policy set for project', {
      projectId,
      region: policy.region,
      storageRegion: policy.storageRegion,
    });
  }

  /**
   * Get data residency policy for a project
   */
  async getProjectPolicy(projectId: string): Promise<DataResidencyPolicy> {
    const policy = await this.repository.getProjectPolicy(projectId);
    if (!policy) {
      return getDataResidencyPolicy('global');
    }
    return policy;
  }

  /**
   * Validate a storage operation against the project's data residency policy
   */
  async validateStorageOperation(
    projectId: string,
    operation: 'create' | 'read' | 'update' | 'delete' | 'export',
    targetRegion?: StorageRegion
  ): Promise<DataResidencyValidationResult> {
    const policy = await this.getProjectPolicy(projectId);
    const warnings: string[] = [];

    // Determine target region
    let effectiveTargetRegion = targetRegion ?? policy.storageRegion;

    // If 'auto', use the default for the data residency region
    if (effectiveTargetRegion === 'auto') {
      effectiveTargetRegion = getDefaultStorageRegionFor(policy.region);
    }

    // Strict regions must never use 'auto' storage
    if (DataResidencyService.isStrictRegion(policy.region) && effectiveTargetRegion === 'auto') {
      return {
        allowed: false,
        reason: `Storage region 'auto' is not allowed for strict data residency region '${policy.region}'`,
        policy,
        targetRegion: effectiveTargetRegion,
      };
    }

    // Check if target region is allowed for this policy
    const allowed = ALLOWED_STORAGE_REGIONS[policy.region];
    if (!allowed.includes(effectiveTargetRegion) && effectiveTargetRegion !== 'auto') {
      const violation = await this.recordViolation({
        projectId,
        violationType: 'storage_region_mismatch',
        description: `Storage operation to region '${effectiveTargetRegion}' not allowed for data residency region '${policy.region}'`,
        attemptedAction: operation,
        targetRegion: effectiveTargetRegion,
        blocked: true,
      });

      logger.warn('Data residency violation: storage region mismatch', {
        projectId,
        violationId: violation.id,
        operation,
        targetRegion: effectiveTargetRegion,
        allowedRegions: allowed,
      });

      return {
        allowed: false,
        reason: `Storage region '${effectiveTargetRegion}' is not allowed for data residency region '${policy.region}'`,
        policy,
        targetRegion: effectiveTargetRegion,
      };
    }

    // Check if target region is available
    if (!isRegionAvailable(effectiveTargetRegion)) {
      // For strict regions (kz, rf), this is a hard failure
      if (DataResidencyService.isStrictRegion(policy.region)) {
        return {
          allowed: false,
          reason: `Required storage region '${effectiveTargetRegion}' is not available. Configure regional storage for ${policy.region.toUpperCase()} compliance.`,
          policy,
          targetRegion: effectiveTargetRegion,
        };
      }

      // For other regions, warn but allow fallback
      warnings.push(`Storage region '${effectiveTargetRegion}' is not available, using fallback`);
      effectiveTargetRegion = getDefaultStorageRegionFor(policy.region);
    }

    // Check cross-region export restrictions
    if (operation === 'export' && !policy.allowCrossRegionBackup) {
      warnings.push(
        'Export operation restricted by data residency policy. Data must remain in region.'
      );
    }

    return {
      allowed: true,
      policy,
      targetRegion: effectiveTargetRegion,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Validate cross-region data transfer
   */
  async validateCrossRegionTransfer(
    projectId: string,
    sourceRegion: StorageRegion,
    targetRegion: StorageRegion
  ): Promise<DataResidencyValidationResult> {
    const policy = await this.getProjectPolicy(projectId);

    // Same region is always allowed
    if (sourceRegion === targetRegion) {
      return {
        allowed: true,
        policy,
        targetRegion,
      };
    }

    // Check if cross-region backup is allowed
    if (!policy.allowCrossRegionBackup) {
      const violation = await this.recordViolation({
        projectId,
        violationType: 'cross_region_transfer',
        description: `Cross-region transfer from '${sourceRegion}' to '${targetRegion}' blocked by policy`,
        attemptedAction: 'transfer',
        sourceRegion,
        targetRegion,
        blocked: true,
      });

      logger.warn('Data residency violation: cross-region transfer blocked', {
        projectId,
        violationId: violation.id,
        sourceRegion,
        targetRegion,
      });

      return {
        allowed: false,
        reason: `Cross-region data transfer is not allowed by data residency policy (${policy.region})`,
        policy,
        targetRegion,
      };
    }

    // Check if target region is allowed for this policy
    const allowed = ALLOWED_STORAGE_REGIONS[policy.region];
    if (!allowed.includes(targetRegion)) {
      return {
        allowed: false,
        reason: `Target region '${targetRegion}' is not allowed for data residency region '${policy.region}'`,
        policy,
        targetRegion,
      };
    }

    return {
      allowed: true,
      policy,
      targetRegion,
      warnings: ['Cross-region transfer allowed within compliant regions'],
    };
  }

  /**
   * Get the storage configuration for a project
   * Returns the regional storage config if configured, otherwise null (use default)
   */
  async getProjectStorageConfig(projectId: string) {
    const policy = await this.getProjectPolicy(projectId);
    let storageRegion = policy.storageRegion;

    // Resolve 'auto' to the default region for the policy
    if (storageRegion === 'auto') {
      storageRegion = getDefaultStorageRegionFor(policy.region);
    }

    return getRegionalStorageConfig(storageRegion);
  }

  /**
   * Record a data residency violation
   */
  async recordViolation(
    params: Omit<DataResidencyViolation, 'id' | 'createdAt'>
  ): Promise<DataResidencyViolation> {
    const row = await this.repository.insertViolation({
      project_id: params.projectId,
      violation_type: params.violationType,
      description: params.description,
      attempted_action: params.attemptedAction,
      user_id: params.userId,
      source_region: params.sourceRegion,
      target_region: params.targetRegion,
      blocked: params.blocked,
    });

    logger.warn('Data residency violation recorded', {
      violationId: row.id,
      projectId: row.project_id,
      type: row.violation_type,
      blocked: row.blocked,
    });

    return {
      id: row.id,
      createdAt: row.created_at,
      projectId: row.project_id,
      violationType: row.violation_type as DataResidencyViolation['violationType'],
      description: row.description,
      attemptedAction: row.attempted_action,
      userId: row.user_id || undefined,
      sourceRegion: (row.source_region as StorageRegion) || undefined,
      targetRegion: (row.target_region as StorageRegion) || undefined,
      blocked: row.blocked,
    };
  }

  /**
   * Get violations for a project
   */
  async getProjectViolations(
    projectId: string,
    options?: ViolationQueryOptions
  ): Promise<DataResidencyViolation[]> {
    const rows = await this.repository.getProjectViolations(projectId, options);

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      projectId: row.project_id,
      violationType: row.violation_type as DataResidencyViolation['violationType'],
      description: row.description,
      attemptedAction: row.attempted_action,
      userId: row.user_id || undefined,
      sourceRegion: (row.source_region as StorageRegion) || undefined,
      targetRegion: (row.target_region as StorageRegion) || undefined,
      blocked: row.blocked,
    }));
  }

  /**
   * Audit data access for compliance
   * Returns null when auditing is disabled for the project
   */
  async auditDataAccess(
    params: Omit<DataResidencyAuditEntry, 'id' | 'createdAt'>
  ): Promise<DataResidencyAuditEntry | null> {
    const policy = await this.getProjectPolicy(params.projectId);

    // Only audit if policy requires it (always audit policy changes)
    if (!policy.auditDataAccess && params.action !== 'policy_changed') {
      return null;
    }

    const row = await this.repository.insertAuditEntry({
      project_id: params.projectId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      storage_region: params.storageRegion,
      user_id: params.userId,
      ip_address: params.ipAddress,
      metadata: params.metadata,
    });

    logger.debug('Data residency audit entry recorded', {
      entryId: row.id,
      projectId: row.project_id,
      action: row.action,
      resourceType: row.resource_type,
    });

    return {
      id: row.id,
      createdAt: row.created_at,
      projectId: row.project_id,
      action: row.action as DataResidencyAuditEntry['action'],
      resourceType: row.resource_type,
      resourceId: row.resource_id || undefined,
      storageRegion: row.storage_region as StorageRegion,
      userId: row.user_id || undefined,
      ipAddress: row.ip_address || undefined,
      metadata: row.metadata || undefined,
    };
  }

  /**
   * Get audit entries for a project
   */
  async getProjectAuditEntries(
    projectId: string,
    options?: AuditQueryOptions
  ): Promise<DataResidencyAuditEntry[]> {
    const rows = await this.repository.getProjectAuditEntries(projectId, options);

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      projectId: row.project_id,
      action: row.action as DataResidencyAuditEntry['action'],
      resourceType: row.resource_type,
      resourceId: row.resource_id || undefined,
      storageRegion: row.storage_region as StorageRegion,
      userId: row.user_id || undefined,
      ipAddress: row.ip_address || undefined,
      metadata: row.metadata || undefined,
    }));
  }

  /**
   * Check if a project has strict data residency requirements
   */
  async hasStrictResidency(projectId: string): Promise<boolean> {
    const policy = await this.getProjectPolicy(projectId);
    return DataResidencyService.isStrictRegion(policy.region);
  }

  /**
   * Get compliance summary for a project
   */
  async getComplianceSummary(projectId: string): Promise<{
    policy: DataResidencyPolicy;
    violationCount: number;
    recentViolations: DataResidencyViolation[];
    isCompliant: boolean;
    storageConfigured: boolean;
    auditCount: number;
    blockedViolationCount: number;
    unblockedViolationCount: number;
  }> {
    const summary = await this.repository.getComplianceSummary(projectId);
    const recentViolations = summary.recentViolations.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      projectId: row.project_id,
      violationType: row.violation_type as DataResidencyViolation['violationType'],
      description: row.description,
      attemptedAction: row.attempted_action,
      userId: row.user_id || undefined,
      sourceRegion: (row.source_region as StorageRegion) || undefined,
      targetRegion: (row.target_region as StorageRegion) || undefined,
      blocked: row.blocked,
    }));

    // Check if storage is configured (either 'auto' which uses defaults, or a specific available region)
    const storageRegion = summary.policy.storageRegion;
    const storageConfigured = storageRegion === 'auto' || isRegionAvailable(storageRegion);

    // Compliance logic:
    // - Blocked violations don't break compliance (system prevented the breach)
    // - Only UNBLOCKED violations indicate actual compliance failure
    // - Storage must be configured for non-global regions
    const unblockedViolations = recentViolations.filter((v) => !v.blocked);
    const isCompliant =
      unblockedViolations.length === 0 && (summary.policy.region === 'global' || storageConfigured);

    return {
      policy: summary.policy,
      violationCount: summary.violationCount,
      recentViolations,
      isCompliant,
      storageConfigured,
      auditCount: summary.auditCount,
      // Include metrics for monitoring even though blocked violations don't affect compliance
      blockedViolationCount: recentViolations.filter((v) => v.blocked).length,
      unblockedViolationCount: unblockedViolations.length,
    };
  }
}
