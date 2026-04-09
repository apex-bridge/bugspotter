/**
 * Organization Request Service
 * API client for admin organization request management.
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  OrganizationRequest,
  ApproveOrgRequestInput,
  RejectOrgRequestInput,
  OrgRequestStatus,
} from '../types/organization';
import type { PaginationMeta } from '../types';

interface ListOrgRequestsParams {
  page?: number;
  limit?: number;
  status?: OrgRequestStatus;
  search?: string;
  sort_by?: string;
  order?: 'asc' | 'desc';
}

export const organizationRequestService = {
  list: async (
    params: ListOrgRequestsParams = {}
  ): Promise<{ data: OrganizationRequest[]; pagination: PaginationMeta }> => {
    const response = await api.get(API_ENDPOINTS.adminOrgRequests.list(), { params });
    return { data: response.data.data, pagination: response.data.pagination };
  },

  getById: async (id: string): Promise<OrganizationRequest> => {
    const response = await api.get(API_ENDPOINTS.adminOrgRequests.get(id));
    return response.data.data;
  },

  approve: async (id: string, input?: ApproveOrgRequestInput): Promise<OrganizationRequest> => {
    const response = await api.patch(API_ENDPOINTS.adminOrgRequests.approve(id), input ?? {});
    return response.data.data;
  },

  reject: async (id: string, input: RejectOrgRequestInput): Promise<OrganizationRequest> => {
    const response = await api.patch(API_ENDPOINTS.adminOrgRequests.reject(id), input);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.adminOrgRequests.delete(id));
  },
};
