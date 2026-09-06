/**
 * SSO Config Service
 * API client for reading and updating an organization's OIDC SSO configuration.
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { SsoConfig, SsoConfigUpdate } from '../types/sso';

export const ssoService = {
  getSettings: async (orgId: string): Promise<SsoConfig> => {
    const response = await api.get(API_ENDPOINTS.organizations.sso(orgId));
    return response.data.data;
  },

  updateSettings: async (orgId: string, payload: SsoConfigUpdate): Promise<SsoConfig> => {
    // payload.clientSecret is optional — callers must omit the key, not send ''
    const response = await api.put(API_ENDPOINTS.organizations.sso(orgId), payload);
    return response.data.data;
  },
};
