/**
 * User Service
 * Handles user management operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  User,
  UserRole,
  UserPreferences,
  CreateUserRequest,
  UpdateUserRequest,
  UserManagementResponse,
} from '../types';

export const userService = {
  getAll: async (
    params: {
      page?: number;
      limit?: number;
      role?: UserRole;
      email?: string;
    } = {}
  ): Promise<UserManagementResponse> => {
    const response = await api.get<{ success: boolean; data: UserManagementResponse }>(
      API_ENDPOINTS.adminUsers.list(),
      { params }
    );
    return response.data.data;
  },

  create: async (data: CreateUserRequest): Promise<User> => {
    const response = await api.post<{ success: boolean; data: User }>(
      API_ENDPOINTS.adminUsers.create(),
      data
    );
    return response.data.data;
  },

  update: async (id: string, data: UpdateUserRequest): Promise<User> => {
    const response = await api.patch<{ success: boolean; data: User }>(
      API_ENDPOINTS.adminUsers.update(id),
      data
    );
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.adminUsers.delete(id));
  },

  // Get current user's preferences
  getPreferences: async (): Promise<UserPreferences> => {
    const response = await api.get<{ success: boolean; data: UserPreferences }>(
      '/api/v1/users/me/preferences'
    );
    return response.data.data;
  },

  // Update current user's preferences
  updatePreferences: async (preferences: Partial<UserPreferences>): Promise<UserPreferences> => {
    const response = await api.patch<{ success: boolean; data: UserPreferences }>(
      '/api/v1/users/me/preferences',
      preferences
    );
    return response.data.data;
  },
};
