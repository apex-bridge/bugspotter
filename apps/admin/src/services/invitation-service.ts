/**
 * Invitation Service
 * Public invitation preview + acceptance helpers.
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { InvitationRole, InvitationStatus } from '../types/organization';

export interface InvitationPreview {
  organization_name: string;
  organization_subdomain: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  expires_at: string;
  inviter_name: string | null;
}

export const invitationService = {
  /** Fetch display-safe invitation details by token (no auth required). */
  preview: async (token: string): Promise<InvitationPreview> => {
    const response = await api.get<{ success: boolean; data: InvitationPreview }>(
      API_ENDPOINTS.invitations.preview(token)
    );
    return response.data.data;
  },
};
