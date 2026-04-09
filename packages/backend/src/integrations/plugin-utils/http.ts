/**
 * HTTP utilities for custom plugins
 * Provides simplified API request handling with consistent error handling
 */

import { createPluginError, ERROR_CODES } from './errors.js';

export interface HttpContext {
  fetch: (
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    }
  ) => Promise<{
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<any>;
    text: () => Promise<string>;
  }>;
}

export interface ApiRequestConfig {
  baseUrl: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  authHeader?: string;
  body?: any;
  contentType?: string;
  accept?: string;
  userAgent?: string;
  customHeaders?: Record<string, string>;
  timeout?: number;
  errorPrefix?: string;
}

/**
 * Make an API request with consistent error handling
 * @param context - Plugin context with http.fetch method
 * @param config - Request configuration
 * @returns Parsed response body
 * @throws PluginError on request failure
 * @example
 * const data = await makeApiRequest(context, {
 *   baseUrl: 'https://api.example.com',
 *   endpoint: '/issues',
 *   method: 'POST',
 *   authHeader: 'Bearer abc123',
 *   body: { title: 'Bug report' }
 * });
 */
export async function makeApiRequest(context: HttpContext, config: ApiRequestConfig): Promise<any> {
  const url = buildUrl(config.baseUrl, config.endpoint);

  const headers: Record<string, string> = {
    'Content-Type': config.contentType || 'application/json',
    Accept: config.accept || 'application/json',
    'User-Agent': config.userAgent || 'BugSpotter/1.0',
    ...(config.customHeaders || {}),
  };

  if (config.authHeader) {
    headers.Authorization = config.authHeader;
  }

  try {
    const response = await context.fetch(url, {
      method: config.method || 'GET',
      headers,
      body: config.body
        ? typeof config.body === 'string'
          ? config.body
          : JSON.stringify(config.body)
        : undefined,
      timeout: config.timeout || 10000,
    });

    if (response.status < 200 || response.status >= 300) {
      const errorBody = await response.text();
      const prefix = config.errorPrefix || 'API request failed';
      throw createPluginError(
        ERROR_CODES.NETWORK_ERROR,
        `${prefix} (${response.status}): ${errorBody.substring(0, 200)}`,
        { statusCode: response.status, url, method: config.method || 'GET' }
      );
    }

    return await parseResponse(response);
  } catch (error) {
    if ((error as any).code) {
      throw error; // Already a PluginError
    }
    throw createPluginError(
      ERROR_CODES.NETWORK_ERROR,
      'Network request failed: ' + (error as Error).message,
      { url, method: config.method || 'GET' }
    );
  }
}

/**
 * Parse HTTP response based on content type
 * @param response - HTTP response object
 * @param options - Parsing options
 * @returns Parsed response body
 */
export async function parseResponse(
  response: {
    headers: { get: (name: string) => string | null };
    json: () => Promise<any>;
    text: () => Promise<string>;
  },
  options: { defaultFormat?: 'json' | 'text' } = {}
): Promise<any> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await response.json();
  }

  if (contentType.includes('text/')) {
    return await response.text();
  }

  if (options.defaultFormat === 'json') {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }

  return await response.text();
}

/**
 * Build URL with query parameters
 * @param baseUrl - Base URL (e.g., "https://api.example.com")
 * @param endpoint - Endpoint path (e.g., "/issues")
 * @param queryParams - Optional query parameters
 * @returns Complete URL with query string
 * @example
 * buildUrl('https://api.example.com', '/issues', { status: 'open', page: 1 })
 * // Returns: "https://api.example.com/issues?status=open&page=1"
 */
export function buildUrl(
  baseUrl: string,
  endpoint: string,
  queryParams: Record<string, any> = {}
): string {
  const base = baseUrl.replace(/\/$/, '');
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const url = new URL(path, base + '/');

  for (const [key, value] of Object.entries(queryParams)) {
    if (value != null) {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}
