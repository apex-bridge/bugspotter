/**
 * Project Member Service
 * Handles project member management operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  ProjectMember,
  AddProjectMemberRequest,
  UpdateProjectMemberRequest,
  UserProject,
} from '../types';

export const projectMemberService = {
  /**
   * Get all members of a project
   */
  getMembers: async (projectId: string): Promise<ProjectMember[]> => {
    const response = await api.get<{ success: boolean; data: ProjectMember[] }>(
      API_ENDPOINTS.projectMembers.list(projectId)
    );
    return response.data.data;
  },

  /**
   * Add a member to a project
   */
  addMember: async (projectId: string, data: AddProjectMemberRequest): Promise<ProjectMember> => {
    const response = await api.post<{ success: boolean; data: ProjectMember }>(
      API_ENDPOINTS.projectMembers.add(projectId),
      data
    );
    return response.data.data;
  },

  /**
   * Update a member's role
   */
  updateMemberRole: async (
    projectId: string,
    userId: string,
    data: UpdateProjectMemberRequest
  ): Promise<ProjectMember> => {
    const response = await api.patch<{ success: boolean; data: ProjectMember }>(
      API_ENDPOINTS.projectMembers.update(projectId, userId),
      data
    );
    return response.data.data;
  },

  /**
   * Remove a member from a project
   */
  removeMember: async (projectId: string, userId: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.projectMembers.remove(projectId, userId));
  },

  /**
   * Get all projects for a user (admin endpoint)
   */
  getUserProjects: async (userId: string): Promise<UserProject[]> => {
    const response = await api.get<{ success: boolean; data: UserProject[] }>(
      API_ENDPOINTS.adminUsers.projects(userId)
    );
    return response.data.data;
  },
};
