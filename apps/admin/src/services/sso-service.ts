/**
 * SSO Config Service
 * API client for reading and updating an organization's OIDC SSO configuration.
 */

import { api } from '../lib/api-client';
import type { SsoConfig, SsoConfigUpdate } from '../types/sso';

// ASSUMED path, not verified — confirm against #353. Mirrors the
// organizations/:id/... convention every other org-scoped settings
// resource uses (intelligence, data-residency, billing). Inlined
// locally rather than promoted into `api-constants.ts`'s
// `API_ENDPOINTS`, matching `integration-service.ts`'s
// `parsePluginCode` precedent, since the real path is still
// unconfirmed pending #353 (spec 0407, "Out of scope").
const ssoConfigPath = (orgId: string) => `/api/v1/organizations/${orgId}/sso`;

export const ssoService = {
  getSettings: async (orgId: string): Promise<SsoConfig> => {
    const response = await api.get(ssoConfigPath(orgId));
    return response.data.data;
  },

  updateSettings: async (orgId: string, payload: SsoConfigUpdate): Promise<SsoConfig> => {
    // payload.clientSecret is optional — callers must omit the key, not send ''
    const response = await api.put(ssoConfigPath(orgId), payload);
    return response.data.data;
  },
};
