/**
 * Project Member Service
 * Business logic for project member management
 */

import type { DatabaseClient } from '../db/client.js';
import type { Project, ProjectMember } from '../db/types.js';
import type { ProjectRole } from '../types/project-roles.js';
import { AppError } from '../api/middleware/error.js';
import { findOrThrow } from '../api/utils/resource.js';
import { requireProjectRole, validateMemberModification } from '../api/utils/authorization.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

const ERROR_MESSAGES = {
  MEMBER_ALREADY_EXISTS: 'User is already a member of this project',
  INSUFFICIENT_PERMISSIONS: 'Only project owners and admins can add members',
  UPDATE_FAILED: 'Failed to update member role',
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface AddMemberInput {
  projectId: string;
  targetUserId: string;
  requesterId: string;
  role: ProjectRole;
  project: Project;
  requesterRole?: ProjectRole | null;
}

export interface UpdateMemberRoleInput {
  projectId: string;
  targetUserId: string;
  requesterId: string;
  newRole: ProjectRole;
  project: Project;
  requesterRole?: ProjectRole | null;
}

export interface RemoveMemberInput {
  projectId: string;
  targetUserId: string;
  requesterId: string;
  project: Project;
  requesterRole?: ProjectRole | null;
}

// ============================================================================
// PROJECT MEMBER SERVICE
// ============================================================================

export class ProjectMemberService {
  constructor(private db: DatabaseClient) {}

  /**
   * Add a new member to a project
   * Validates permissions and prevents duplicate members
   */
  async addMember(input: AddMemberInput): Promise<ProjectMember> {
    const { projectId, targetUserId, requesterId, role, requesterRole } = input;

    // Verify requesting user has admin or owner role
    await requireProjectRole(
      projectId,
      requesterId,
      this.db,
      'admin',
      ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS,
      requesterRole
    );

    // Check if target user exists
    await findOrThrow(() => this.db.users.findById(targetUserId), 'User');

    // Check if user is already a member (including owner)
    const isAlreadyMember = await this.db.projects.hasAccess(projectId, targetUserId);
    if (isAlreadyMember) {
      throw new AppError(ERROR_MESSAGES.MEMBER_ALREADY_EXISTS, 409, 'Conflict');
    }

    // Add member
    const member = await this.db.projectMembers.addMember(projectId, targetUserId, role);

    logger.info('Project member added', {
      project_id: projectId,
      user_id: targetUserId,
      role,
      added_by: requesterId,
    });

    return member;
  }

  /**
   * Update a project member's role
   * Validates permissions and prevents invalid role changes
   */
  async updateMemberRole(input: UpdateMemberRoleInput): Promise<ProjectMember> {
    const { projectId, targetUserId, requesterId, newRole, project, requesterRole } = input;

    // Validate member modification (consolidated authorization logic)
    const { currentMemberRole } = await validateMemberModification({
      projectId,
      targetUserId,
      requesterId,
      db: this.db,
      project,
      operation: 'update',
      newRole,
      cachedRole: requesterRole,
    });

    // Update member role using atomic UPDATE query
    // Note: owner role is handled separately (created_by field), so cast is safe here
    const updated = await this.db.projectMembers.updateMemberRole(
      projectId,
      targetUserId,
      newRole as 'admin' | 'member' | 'viewer'
    );

    if (!updated) {
      throw new AppError(ERROR_MESSAGES.UPDATE_FAILED, 500, 'InternalServerError');
    }

    logger.info('Project member role updated', {
      project_id: projectId,
      user_id: targetUserId,
      old_role: currentMemberRole,
      new_role: newRole,
      updated_by: requesterId,
    });

    return updated;
  }

  /**
   * Remove a member from a project
   * Validates permissions and prevents removing project owner
   */
  async removeMember(input: RemoveMemberInput): Promise<void> {
    const { projectId, targetUserId, requesterId, project, requesterRole } = input;

    // Validate member modification (consolidated authorization logic)
    await validateMemberModification({
      projectId,
      targetUserId,
      requesterId,
      db: this.db,
      project,
      operation: 'remove',
      cachedRole: requesterRole,
    });

    // Remove member
    await this.db.projectMembers.removeMember(projectId, targetUserId);

    logger.info('Project member removed', {
      project_id: projectId,
      user_id: targetUserId,
      removed_by: requesterId,
    });
  }

  /**
   * Get all members of a project
   * No authorization check - assumes caller has project access
   */
  async getMembers(projectId: string): Promise<unknown[]> {
    return await this.db.projects.getProjectMembers(projectId);
  }
}
