/**
 * Jira Client
 * Handles communication with Jira REST API v3
 * Uses native Node.js https module (no external dependencies)
 */

import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { getLogger } from '../../logger.js';
import { validateSSRFProtection } from '../security/ssrf-validator.js';
import type {
  JiraConfig,
  JiraIssueFields,
  JiraIssue,
  JiraAttachment,
  JiraError,
  JiraConnectionTestResult,
  JiraUser,
} from './types.js';

const logger = getLogger();

/**
 * Jira API endpoints
 */
const JIRA_API_BASE = '/rest/api/3';
const JIRA_ENDPOINTS = {
  CREATE_ISSUE: `${JIRA_API_BASE}/issue`,
  GET_ISSUE: (issueKey: string) => `${JIRA_API_BASE}/issue/${issueKey}`,
  ADD_ATTACHMENT: (issueKey: string) => `${JIRA_API_BASE}/issue/${issueKey}/attachments`,
  GET_PROJECT: (projectKey: string) => `${JIRA_API_BASE}/project/${projectKey}`,
  GET_MYSELF: `${JIRA_API_BASE}/myself`,
  SEARCH_USERS: `${JIRA_API_BASE}/user/search`,
} as const;

/**
 * HTTP request options
 */
interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers: Record<string, string>;
  body?: string | Buffer;
}

/**
 * Jira Client
 * Handles all Jira REST API v3 operations
 */
export class JiraClient {
  private host: string;
  private email: string;
  private apiToken: string;
  private baseUrl: URL;

  constructor(config: JiraConfig) {
    // Validate configuration
    if (!config.host || !config.email || !config.apiToken) {
      throw new Error('Jira configuration incomplete: host, email, and apiToken are required');
    }

    this.host = config.host.replace(/\/$/, ''); // Remove trailing slash
    this.email = config.email;
    this.apiToken = config.apiToken;

    // SSRF Protection: Validate host URL before making any requests
    // Blocks private IPs, localhost, cloud metadata endpoints, etc.
    try {
      this.baseUrl = validateSSRFProtection(this.host);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid URL';
      throw new Error(`Invalid Jira host URL (${this.host}): ${message}`);
    }

    // Enforce HTTPS: This client uses Node's https module exclusively
    // http:// URLs would pass SSRF validation but fail with TLS errors during requests
    if (this.baseUrl.protocol !== 'https:') {
      throw new Error(
        `Invalid Jira host protocol (${this.host}): Only HTTPS is supported. ` +
          `Received ${this.baseUrl.protocol}, expected https:`
      );
    }

    logger.debug('Jira client initialized', {
      host: this.host,
      email: this.email,
    });
  }

  /**
   * Parse request body for logging
   */
  private parseRequestBody(body: string | Buffer): unknown {
    const bodyString = body.toString();
    try {
      return JSON.parse(bodyString);
    } catch {
      return bodyString;
    }
  }

  /**
   * Make authenticated HTTP request to Jira API
   */
  private async request<T = unknown>(options: RequestOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');

      const requestOptions = {
        hostname: this.baseUrl.hostname,
        port: this.baseUrl.port || 443,
        path: options.path,
        method: options.method,
        headers: {
          ...options.headers,
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };

      const req = httpsRequest(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const statusCode = res.statusCode || 0;

          // Parse request body for logging (both success and error cases)
          const requestBody = options.body ? this.parseRequestBody(options.body) : undefined;

          // Handle error status codes
          if (statusCode >= 400) {
            let errorMessage = `Jira API error: ${statusCode}`;
            let errorData: JiraError | null = null;
            try {
              errorData = JSON.parse(data);
              if (errorData?.errorMessages && errorData.errorMessages.length > 0) {
                errorMessage = errorData.errorMessages.join(', ');
              } else if (errorData?.errors) {
                errorMessage = Object.values(errorData.errors).join(', ');
              }
            } catch {
              errorMessage = data || errorMessage;
            }

            logger.error('Jira API request failed', {
              statusCode,
              path: options.path,
              method: options.method,
              error: errorMessage,
              requestBody,
              responseBody: errorData || data,
            });

            return reject(new Error(errorMessage));
          }

          // Log successful requests at debug level
          logger.debug('Jira API request succeeded', {
            statusCode,
            path: options.path,
            method: options.method,
            requestBody,
          });

          // Parse response
          try {
            const result = data ? JSON.parse(data) : null;
            resolve(result as T);
          } catch (error) {
            logger.error('Failed to parse Jira response', {
              path: options.path,
              error: error instanceof Error ? error.message : String(error),
            });
            reject(new Error('Invalid JSON response from Jira'));
          }
        });
      });

      req.on('error', (error) => {
        logger.error('Jira API request error', {
          path: options.path,
          error: error.message,
        });
        reject(new Error(`Failed to connect to Jira: ${error.message}`));
      });

      // Set timeout
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Jira API request timeout'));
      });

      // Send request body if present
      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Test connection to Jira
   * Validates credentials and project access
   */
  async testConnection(projectKey?: string): Promise<JiraConnectionTestResult> {
    try {
      // Test 1: Verify authentication by getting current user
      logger.debug('Testing Jira connection', { host: this.host, projectKey });

      await this.request({
        method: 'GET',
        path: JIRA_ENDPOINTS.GET_MYSELF,
        headers: {},
      });

      // Test 2: Verify project exists and user has access (if projectKey provided)
      let projectExists = true;
      let userHasAccess = true;

      if (projectKey) {
        try {
          await this.request({
            method: 'GET',
            path: JIRA_ENDPOINTS.GET_PROJECT(projectKey),
            headers: {},
          });
        } catch (error) {
          projectExists = false;
          userHasAccess = false;
          logger.warn('Project not found or access denied', { projectKey, error });
        }
      }

      logger.info('Jira connection test successful', {
        host: this.host,
        projectKey,
        projectExists,
      });

      return {
        valid: true,
        details: {
          host: this.host,
          projectExists,
          userHasAccess,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Jira connection test failed', {
        host: this.host,
        error: errorMessage,
      });

      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Create Jira issue
   */
  async createIssue(fields: JiraIssueFields): Promise<JiraIssue> {
    logger.info('Creating Jira issue', {
      projectKey: fields.project.key,
      issueType: fields.issuetype.name,
      summary: fields.summary,
    });

    const body = JSON.stringify({ fields });

    const response = await this.request<JiraIssue>({
      method: 'POST',
      path: JIRA_ENDPOINTS.CREATE_ISSUE,
      headers: {},
      body,
    });

    logger.info('Jira issue created', {
      issueKey: response.key,
      issueId: response.id,
      issueUrl: `${this.host}/browse/${response.key}`,
    });

    return response;
  }

  /**
   * Get Jira issue by key
   */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    logger.debug('Fetching Jira issue', { issueKey });

    return this.request<JiraIssue>({
      method: 'GET',
      path: JIRA_ENDPOINTS.GET_ISSUE(issueKey),
      headers: {},
    });
  }

  /**
   * Upload attachment to Jira issue
   * Uses multipart/form-data encoding with streaming to prevent memory issues
   * Implements proper backpressure handling for streams
   */
  async uploadAttachment(
    issueKey: string,
    file: Buffer | NodeJS.ReadableStream,
    filename: string
  ): Promise<JiraAttachment> {
    const isStream = !Buffer.isBuffer(file);
    const buffer = isStream ? null : (file as Buffer);

    logger.info('Uploading attachment to Jira', {
      issueKey,
      filename,
      size: isStream ? 'streaming' : buffer!.length,
    });

    return new Promise((resolve, reject) => {
      const boundary = `----WebKitFormBoundary${Date.now()}`;
      const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');

      // Build headers with optional Content-Length for buffers
      const headers: Record<string, string> = {
        Authorization: `Basic ${auth}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-Atlassian-Token': 'no-check', // Required by Jira
      };

      // For buffers, calculate exact content length (better performance)
      if (!isStream && buffer) {
        const preamble = Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n`
        );
        const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
        headers['Content-Length'] = String(preamble.length + buffer.length + epilogue.length);
      }

      const requestOptions = {
        hostname: this.baseUrl.hostname,
        port: this.baseUrl.port || 443,
        path: JIRA_ENDPOINTS.ADD_ATTACHMENT(issueKey),
        method: 'POST',
        headers,
      };

      const req = httpsRequest(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const statusCode = res.statusCode || 0;

          if (statusCode >= 400) {
            logger.error('Failed to upload attachment to Jira', {
              statusCode,
              issueKey,
              filename,
              response: data,
            });
            return reject(new Error(`Failed to upload attachment: HTTP ${statusCode}`));
          }

          try {
            const attachments = JSON.parse(data) as JiraAttachment[];
            const attachment = attachments[0];

            if (!attachment) {
              return reject(new Error('No attachment returned from Jira'));
            }

            logger.info('Attachment uploaded to Jira', {
              issueKey,
              filename,
              attachmentId: attachment.id,
            });

            resolve(attachment);
          } catch (error) {
            reject(
              new Error(
                `Failed to parse attachment response: ${error instanceof Error ? error.message : String(error)}`
              )
            );
          }
        });
      });

      req.on('error', (error) => {
        logger.error('Attachment upload error', {
          issueKey,
          filename,
          error: error.message,
        });
        reject(new Error(`Failed to upload attachment: ${error.message}`));
      });

      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('Attachment upload timeout (60s)'));
      });

      // Write multipart form data
      const preamble =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`;

      const epilogue = `\r\n--${boundary}--\r\n`;

      // Write preamble
      req.write(preamble);

      if (isStream) {
        // Stream with proper backpressure handling
        const stream = file as NodeJS.ReadableStream;
        let streamEnded = false;

        stream.on('data', (chunk: Buffer) => {
          // Respect backpressure - pause stream if request buffer is full
          if (!req.write(chunk)) {
            stream.pause();
          }
        });

        // Resume stream when request buffer drains
        req.on('drain', () => {
          if (!streamEnded) {
            stream.resume();
          }
        });

        stream.on('end', () => {
          streamEnded = true;
          req.write(epilogue);
          req.end();
        });

        stream.on('error', (error) => {
          streamEnded = true;
          req.destroy();
          reject(new Error(`Stream error: ${error.message}`));
        });
      } else {
        // Write buffer directly
        req.write(buffer!);
        req.write(epilogue);
        req.end();
      }
    });
  }

  /**
   * Search for Jira users by query (email, name, etc.)
   * @param query - Search query (email, display name, or username)
   * @param maxResults - Maximum number of results (default: 10)
   * @returns Array of matching users
   */
  async searchUsers(query: string, maxResults = 10): Promise<JiraUser[]> {
    // Jira user search API: GET /rest/api/3/user/search?query={query}&maxResults={maxResults}
    const searchParams = new URLSearchParams({
      query: query.trim(),
      maxResults: maxResults.toString(),
    });

    const path = `${JIRA_ENDPOINTS.SEARCH_USERS}?${searchParams.toString()}`;

    logger.debug('Searching Jira users', {
      query: query.substring(0, 20), // Truncate for privacy
      maxResults,
    });

    const response = await this.request<JiraUser[]>({
      method: 'GET',
      path,
      headers: {},
    });

    logger.debug('Jira user search completed', {
      resultCount: response.length,
    });

    return response;
  }

  /**
   * Get Jira issue URL
   */
  getIssueUrl(issueKey: string): string {
    return `${this.host}/browse/${issueKey}`;
  }
}
