/**
 * Generic HTTP Integration Service
 * Configurable integration service for any HTTP REST API
 */

import type { BugReport } from '../../db/types.js';
import type {
  IntegrationService,
  IntegrationResult,
  TicketCreationMetadata,
} from '../base-integration.service.js';
import type { DatabaseClient } from '../../db/client.js';
import type { GenericHttpConfig, GenericHttpResult } from './types.js';
import { GenericHttpClient } from './client.js';
import { GenericHttpMapper } from './mapper.js';
import { validateSSRFProtection } from '../security/ssrf-validator.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Generic HTTP Integration Service
 * Works with any REST API using configurable endpoints and field mappings
 */
export class GenericHttpService implements IntegrationService {
  readonly platform: string;
  private config: GenericHttpConfig;
  private client: GenericHttpClient;
  private mapper: GenericHttpMapper;
  private db: DatabaseClient;

  constructor(platform: string, config: GenericHttpConfig, db: DatabaseClient) {
    this.platform = platform;
    this.config = config;
    this.db = db;
    this.client = new GenericHttpClient(config);
    this.mapper = new GenericHttpMapper(config.fieldMappings);

    logger.info('Generic HTTP service initialized', {
      platform,
      baseUrl: config.baseUrl,
      authType: config.auth.type,
    });
  }

  /**
   * Create issue/ticket from bug report
   * @param integrationId - Specific integration instance ID for logging and audit trail (config is passed during service instantiation)
   * @param metadata - Optional metadata for ticket creation (rule_id, created_automatically)
   */
  async createFromBugReport(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    metadata?: TicketCreationMetadata
  ): Promise<IntegrationResult> {
    logger.info('Creating external issue from bug report', {
      platform: this.platform,
      bugReportId: bugReport.id,
      projectId,
      integrationId,
      ruleId: metadata?.ruleId,
      createdAutomatically: metadata?.createdAutomatically,
    });

    // Check if create endpoint is configured
    if (!this.config.endpoints.create) {
      throw new Error(`Create endpoint not configured for ${this.platform} integration`);
    }

    const endpoint = this.config.endpoints.create;

    // Map bug report to external format
    const mappedData = this.mapper.mapBugReport(bugReport);

    // Apply body template if configured
    const body = this.mapper.applyBodyTemplate(endpoint, bugReport, mappedData);

    // Make HTTP request
    const response = await this.client.request(endpoint, body as Record<string, unknown>);

    // Extract external ID and URL from response
    const result = this.processResponse(response.data, response.status);

    logger.info('External issue created successfully', {
      platform: this.platform,
      bugReportId: bugReport.id,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
    });

    // Save ticket reference (with metadata)
    await this.saveTicketReference(
      bugReport.id,
      result.externalId,
      result.externalUrl,
      integrationId,
      metadata?.ruleId,
      metadata?.createdAutomatically
    );

    return {
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      platform: this.platform,
      metadata: {
        rawResponse: result.rawResponse,
        statusCode: result.statusCode,
      },
    };
  }

  /**
   * Test connection to external platform
   */
  async testConnection(projectId: string): Promise<boolean> {
    try {
      // Use test endpoint if configured
      if (this.config.endpoints.test) {
        const response = await this.client.request(this.config.endpoints.test);
        return response.status >= 200 && response.status < 300;
      }

      // Otherwise assume connection is valid if config exists
      logger.warn('No test endpoint configured, assuming connection is valid', {
        platform: this.platform,
        projectId,
      });
      return true;
    } catch (error) {
      logger.error('Connection test failed', {
        platform: this.platform,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Validate configuration
   */
  async validateConfig(
    config: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string; details?: Record<string, unknown> }> {
    try {
      const httpConfig = config as unknown as GenericHttpConfig;

      // Validate required fields
      if (!httpConfig.baseUrl) {
        return { valid: false, error: 'baseUrl is required' };
      }

      // SECURITY: Validate baseUrl against SSRF attacks
      // This prevents configuration of internal network addresses, cloud metadata, etc.
      try {
        validateSSRFProtection(httpConfig.baseUrl);
      } catch (ssrfError) {
        logger.warn('SSRF validation failed for integration config', {
          baseUrl: httpConfig.baseUrl.substring(0, 50),
          error: ssrfError instanceof Error ? ssrfError.message : String(ssrfError),
        });
        return {
          valid: false,
          error:
            'baseUrl is not allowed: ' +
            (ssrfError instanceof Error ? ssrfError.message : 'invalid URL'),
        };
      }

      if (!httpConfig.auth) {
        return { valid: false, error: 'auth configuration is required' };
      }

      if (!httpConfig.endpoints) {
        return { valid: false, error: 'endpoints configuration is required' };
      }

      if (!httpConfig.fieldMappings || httpConfig.fieldMappings.length === 0) {
        return { valid: false, error: 'at least one field mapping is required' };
      }

      // Validate create endpoint exists
      if (!httpConfig.endpoints.create) {
        return { valid: false, error: 'create endpoint is required' };
      }

      // Validate response mapping
      if (!httpConfig.endpoints.create.responseMapping) {
        return { valid: false, error: 'create endpoint must have responseMapping configured' };
      }

      if (!httpConfig.endpoints.create.responseMapping.idField) {
        return { valid: false, error: 'create endpoint responseMapping must have idField' };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: 'Invalid configuration format',
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Process API response and extract result
   */
  private processResponse(data: any, statusCode: number): GenericHttpResult {
    const endpoint = this.config.endpoints.create!;
    const responseMapping = endpoint.responseMapping!;

    // Extract external ID
    const externalId = this.mapper.extractId(data, responseMapping.idField);

    // Build external URL
    const externalUrl = this.mapper.buildUrl(data, this.config.baseUrl, responseMapping);

    return {
      externalId,
      externalUrl,
      rawResponse: data,
      statusCode,
    };
  }

  /**
   * Save ticket reference to database
   * @param metadata - Optional metadata for automatic ticket creation
   */
  private async saveTicketReference(
    bugReportId: string,
    externalId: string,
    externalUrl: string,
    integrationId?: string,
    ruleId?: string,
    createdAutomatically?: boolean
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Save to tickets table with metadata
      await tx.tickets.createTicket(bugReportId, externalId, this.platform, undefined, {
        integrationId,
        ruleId,
        createdAutomatically,
        externalUrl,
      });

      // Save to bug_reports metadata (denormalized, fast access)
      await tx.bugReports.updateExternalIntegration(bugReportId, externalId, externalUrl);

      logger.debug('Saved ticket reference to both tables', {
        bugReportId,
        externalId,
        externalUrl,
        platform: this.platform,
        integrationId,
        ruleId,
        createdAutomatically,
      });
    });
  }
}
