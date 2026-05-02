/**
 * Generic HTTP Integration Client
 * Handles HTTP requests with authentication, retries, and error handling
 *
 * Security: Validates all URLs against SSRF attacks before making requests
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { Agent as HttpAgent } from 'http';
import { getLogger } from '../../logger.js';
import { validateSSRFProtection } from '../security/ssrf-validator.js';
import { createPinnedAgent, pinHostnameToIp } from '../security/hardened-http.js';
import type { GenericHttpConfig, EndpointConfig, HttpMethod, AuthConfig } from './types.js';

const logger = getLogger();

/**
 * Generic HTTP Client
 * Configurable HTTP client for any REST API
 */
export class GenericHttpClient {
  private client: AxiosInstance;
  private config: GenericHttpConfig;
  private parsedBaseUrl: URL;

  constructor(config: GenericHttpConfig) {
    this.config = config;

    // SECURITY: Validate baseUrl against SSRF attacks before creating client
    // This prevents requests to internal networks, cloud metadata endpoints, etc.
    this.parsedBaseUrl = validateSSRFProtection(config.baseUrl);

    // Create axios instance with base configuration
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BugSpotter-Integration/1.0',
      },
    });

    // Add authentication interceptor
    this.client.interceptors.request.use((requestConfig) => {
      this.addAuthentication(requestConfig, config.auth);
      return requestConfig;
    });

    // Add retry interceptor
    this.setupRetryLogic(config.retryAttempts || 3, config.retryDelay || 1000);

    // Add logging interceptor
    this.setupLogging();
  }

  /**
   * Make HTTP request to configured endpoint
   */
  async request(endpoint: EndpointConfig, data?: Record<string, unknown>): Promise<AxiosResponse> {
    const requestConfig: AxiosRequestConfig = {
      url: endpoint.path,
      method: endpoint.method.toLowerCase() as Lowercase<HttpMethod>,
      headers: endpoint.headers || {},
    };

    // Add body for non-GET requests
    if (data && endpoint.method !== 'GET') {
      requestConfig.data = data;
    } else if (data && endpoint.method === 'GET') {
      requestConfig.params = data;
    }

    // SSRF Protection (DNS rebinding): build a fresh per-request agent
    // whose `lookup` is pinned to a single resolved + validated IP.
    // The constructor already rejected obviously-bad URL strings, but
    // Node re-resolves DNS on every connection — without this pin, an
    // attacker controlling the hostname's resolver could return a
    // public IP for the validation lookup and a private IP (127.x,
    // 169.254.x, 10.x) on the actual connect, routing auth-bearing
    // requests at internal services. Pinning per-request (not per-
    // client) handles legitimate IP rotation and re-validates on every
    // call. Both http: and https: are pinned: integrations carry auth
    // tokens (bearer/basic/api-key) regardless of scheme, so an HTTP
    // base URL is just as exploitable for rebinding as an HTTPS one.
    if (this.parsedBaseUrl.protocol === 'https:') {
      const { agent } = await createPinnedAgent(this.parsedBaseUrl.hostname);
      requestConfig.httpsAgent = agent;
    } else if (this.parsedBaseUrl.protocol === 'http:') {
      const { lookup } = await pinHostnameToIp(this.parsedBaseUrl.hostname);
      requestConfig.httpAgent = new HttpAgent({ lookup, keepAlive: false });
    }

    logger.debug('Making HTTP request', {
      baseUrl: this.config.baseUrl,
      path: endpoint.path,
      method: endpoint.method,
    });

    return await this.client.request(requestConfig);
  }

  /**
   * Add authentication to request
   */
  private addAuthentication(requestConfig: AxiosRequestConfig, auth: AuthConfig): void {
    if (!requestConfig.headers) {
      requestConfig.headers = {};
    }

    switch (auth.type) {
      case 'bearer':
        if (auth.token) {
          requestConfig.headers['Authorization'] = `Bearer ${auth.token}`;
        }
        break;

      case 'basic':
        if (auth.username && auth.password) {
          const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          requestConfig.headers['Authorization'] = `Basic ${credentials}`;
        }
        break;

      case 'api_key':
        if (auth.apiKey) {
          const headerName = auth.apiKeyHeader || 'X-API-Key';
          requestConfig.headers[headerName] = auth.apiKey;
        }
        break;

      case 'oauth2':
        if (auth.accessToken) {
          requestConfig.headers['Authorization'] = `Bearer ${auth.accessToken}`;
        }
        break;

      case 'none':
      default:
        // No authentication
        break;
    }
  }

  /**
   * Setup retry logic for transient failures
   */
  private setupRetryLogic(maxRetries: number, delayMs: number): void {
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config as AxiosRequestConfig & { _retryCount?: number };

        // Don't retry if already exceeded max attempts
        if (!config || (config._retryCount || 0) >= maxRetries) {
          return Promise.reject(error);
        }

        // Only retry on network errors or 5xx responses
        const shouldRetry =
          !error.response ||
          (error.response.status >= 500 && error.response.status < 600) ||
          error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT';

        if (!shouldRetry) {
          return Promise.reject(error);
        }

        // Increment retry count
        config._retryCount = (config._retryCount || 0) + 1;

        logger.warn('Retrying HTTP request', {
          url: config.url,
          attempt: config._retryCount,
          maxRetries,
          error: error.message,
        });

        // Wait before retrying with exponential backoff
        const delay = delayMs * Math.pow(2, config._retryCount - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));

        return this.client.request(config);
      }
    );
  }

  /**
   * Setup request/response logging
   */
  private setupLogging(): void {
    // Request logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('HTTP request', {
          method: config.method?.toUpperCase(),
          url: `${config.baseURL}${config.url}`,
          headers: this.sanitizeHeaders(config.headers),
        });
        return config;
      },
      (error) => {
        logger.error('HTTP request error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('HTTP response', {
          status: response.status,
          statusText: response.statusText,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error('HTTP response error', {
            status: error.response.status,
            statusText: error.response.statusText,
            url: error.config?.url,
            data: error.response.data,
          });
        } else {
          logger.error('HTTP network error', {
            message: error.message,
            code: error.code,
            url: error.config?.url,
          });
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Sanitize headers for logging (remove sensitive data)
   */
  private sanitizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
    if (!headers) {
      return {};
    }

    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'x-api-key', 'api-key'];

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = String(value);
      }
    }

    return sanitized;
  }
}
