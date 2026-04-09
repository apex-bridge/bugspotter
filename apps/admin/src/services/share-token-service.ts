/**
 * Share Token Service
 * Handles share token operations for public replay sharing
 */

import axios from 'axios';
import { api } from '../lib/api-client';

export interface ShareToken {
  id: string;
  token: string;
  expires_at: string;
  share_url: string;
  password_protected: boolean;
  view_count: number;
  created_by: string | null;
  created_at: string;
}

export interface CreateShareTokenRequest {
  expires_in_hours?: number;
  password?: string;
}

export interface CreateShareTokenResponse {
  token: string;
  expires_at: string;
  share_url: string;
  password_protected: boolean;
}

export const shareTokenService = {
  /**
   * Create a new share token for a bug report
   */
  create: async (
    bugReportId: string,
    data: CreateShareTokenRequest
  ): Promise<CreateShareTokenResponse> => {
    const response = await api.post<{ success: boolean; data: CreateShareTokenResponse }>(
      `/api/v1/replays/${bugReportId}/share`,
      data
    );
    return response.data.data;
  },

  /**
   * Get the active share token for a bug report (if exists)
   */
  getActive: async (bugReportId: string): Promise<ShareToken | null> => {
    try {
      const response = await api.get<{ success: boolean; data: ShareToken }>(
        `/api/v1/replays/${bugReportId}/share`
      );
      return response.data.data;
    } catch (error: unknown) {
      // 404 means no active share token exists
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Revoke (delete) a share token
   */
  revoke: async (token: string): Promise<void> => {
    await api.delete(`/api/v1/replays/share/${token}`);
  },
};
