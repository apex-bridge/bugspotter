/**
 * Generic HTTP Integration Types
 */

/**
 * HTTP methods supported
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Authentication types supported
 */
export type AuthType = 'none' | 'bearer' | 'basic' | 'api_key' | 'oauth2';

/**
 * Authentication configuration
 */
export interface AuthConfig {
  type: AuthType;
  token?: string; // For bearer auth
  username?: string; // For basic auth
  password?: string; // For basic auth
  apiKey?: string; // For API key auth
  apiKeyHeader?: string; // Header name for API key (default: 'X-API-Key')
  accessToken?: string; // For OAuth2
  refreshToken?: string; // For OAuth2
}

/**
 * HTTP endpoint configuration
 */
export interface EndpointConfig {
  path: string; // URL path (e.g., '/issues')
  method: HttpMethod; // HTTP method
  headers?: Record<string, string>; // Additional headers
  bodyTemplate?: string; // Template string for request body (supports {{variables}})
  responseMapping?: {
    idField: string; // JSON path to extract external ID (e.g., 'data.id' or 'key')
    urlField?: string; // JSON path to extract URL (e.g., 'data.html_url')
    urlTemplate?: string; // Template to construct URL (e.g., '{{baseUrl}}/issues/{{id}}')
  };
}

/**
 * Field mapping for bug report → external platform
 */
export interface FieldMapping {
  bugReportField: string; // Source field from BugReport
  externalField: string; // Target field in external API
  transform?: 'uppercase' | 'lowercase' | 'trim' | 'json_stringify'; // Optional transformation
  defaultValue?: unknown; // Default if source is empty
}

/**
 * Generic HTTP integration configuration
 */
export interface GenericHttpConfig {
  baseUrl: string; // Base URL of the API (e.g., 'https://api.example.com')
  auth: AuthConfig; // Authentication configuration
  endpoints: {
    create?: EndpointConfig; // Endpoint for creating issues/tickets
    test?: EndpointConfig; // Endpoint for testing connection (optional)
    update?: EndpointConfig; // Endpoint for updating issues (optional)
    get?: EndpointConfig; // Endpoint for fetching issues (optional)
  };
  fieldMappings: FieldMapping[]; // Field mappings for bug reports
  timeout?: number; // Request timeout in ms (default: 30000)
  retryAttempts?: number; // Number of retry attempts (default: 3)
  retryDelay?: number; // Delay between retries in ms (default: 1000)
}

/**
 * Generic HTTP integration result
 */
export interface GenericHttpResult {
  externalId: string;
  externalUrl: string;
  rawResponse: Record<string, unknown>; // Full API response
  statusCode: number;
}
