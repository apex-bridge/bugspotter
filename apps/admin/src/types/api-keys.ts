import type { ApiKeyType, PermissionScope, ApiKeyStatus } from '@bugspotter/types';

export interface ApiKey {
  id: string;
  name: string;
  type: ApiKeyType;
  allowed_projects: string[] | null;
  key_prefix: string;
  permission_scope: PermissionScope;
  permissions: string[];
  status: ApiKeyStatus;
  expires_at: string | null;
  rotate_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface CreateApiKeyData {
  name: string;
  type: ApiKeyType;
  permission_scope: PermissionScope;
  permissions?: string[];
  allowed_projects?: string[];
  allowed_origins?: string[];
  rate_limit_per_minute?: number;
  rate_limit_per_hour?: number;
  rate_limit_per_day?: number;
  expires_at?: string;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  type: ApiKeyType;
  allowed_projects: string[] | null;
  api_key: string;
  key_prefix: string;
  permissions: string[];
  created_at: string;
}

export interface ApiKeyUsage {
  id: string;
  name: string;
  total_requests: number;
  requests_last_24h: number;
  requests_last_7d: number;
  requests_last_30d: number;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyListResponse {
  data: ApiKey[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
