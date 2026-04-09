/**
 * Auth Service
 * Handles authentication operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { AuthResponse } from '../types';

export const authService = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.auth.login(),
      {
        email,
        password,
      }
    );
    return response.data.data;
  },

  magicLogin: async (token: string): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.auth.magicLogin(),
      {
        token,
      }
    );
    return response.data.data;
  },

  register: async (
    email: string,
    password: string,
    name?: string,
    inviteToken?: string
  ): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.auth.register(),
      {
        email,
        password,
        ...(name ? { name } : {}),
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      }
    );
    return response.data.data;
  },

  getRegistrationStatus: async (): Promise<{
    allowed: boolean;
    requireInvitation: boolean;
  }> => {
    const response = await api.get<{
      success: boolean;
      data: { allowed: boolean; requireInvitation: boolean };
    }>(API_ENDPOINTS.auth.registrationStatus());
    return response.data.data;
  },

  logout: async (): Promise<void> => {
    await api.post(API_ENDPOINTS.auth.logout());
  },

  refreshToken: async (): Promise<string> => {
    const response = await api.post<{ success: boolean; data: { access_token: string } }>(
      API_ENDPOINTS.auth.refresh(),
      {}
    );
    return response.data.data.access_token;
  },
};
