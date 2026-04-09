import type { JiraConfig } from './index';

/**
 * Project-level integration entry
 * Returned by GET /api/v1/projects/:id/integrations
 */
export interface ProjectIntegration {
  platform: string;
  name: string;
  description: string;
  hasRules?: boolean;
  enabled: boolean;
  config?: Record<string, unknown>;
}

/**
 * Backend integration response structure
 * Returned by GET /api/v1/admin/integrations/:type/config
 */
export interface IntegrationResponse {
  id: string;
  type: string;
  name: string;
  description?: string;
  config: JiraConfig;
  status: string;
  is_custom: boolean;
}

/**
 * Type guard to validate integration response structure
 * Ensures the response has a valid config object before accessing it
 */
export function isValidIntegration(data: unknown): data is IntegrationResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'config' in data &&
    typeof (data as IntegrationResponse).config === 'object'
  );
}
