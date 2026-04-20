/**
 * Fastify Server Setup
 * Configures Fastify with all plugins, middleware, and routes
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { config } from '../config.js';
import { getLogger } from '../logger.js';
import { PERMISSIONS_POLICY } from './constants/security-headers.js';
import type { DatabaseClient } from '../db/client.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { REQUEST_BODY_LIMIT } from './utils/constants.js';
import { InvitationEmailService } from '../saas/services/invitation-email.service.js';
import { convertCorsOriginsToRegex } from './utils/cors.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { metricsPlugin } from './middleware/metrics.js';
import { registerGaugeCollectors } from '../metrics/collectors.js';
import { bugReportRoutes } from './routes/reports.js';
import { projectRoutes } from './routes/projects.js';
import { projectMemberRoutes } from './routes/project-members.js';
import { projectIntegrationRoutes } from './routes/project-integrations.js';
import { authRoutes } from './routes/auth.js';
import { signupRoutes } from './routes/signup.js';
import { shareTokenRoutes } from './routes/share-tokens.js';
import { retentionRoutes } from './routes/retention.js';
import { dataResidencyRoutes } from './routes/data-residency.js';
import { organizationRoutes } from './routes/organizations.js';
import { billingRoutes } from './routes/billing.js';
import { invoiceBillingRoutes } from './routes/invoice-billing.js';
import { BillingRegionRegistry, KzBillingPlugin } from '@bugspotter/billing';
import { jobRoutes } from './routes/jobs.js';
import { registerIntegrationRoutes } from './routes/integrations.js';
import { registerIntegrationRuleRoutes } from './routes/integration-rules.js';
import { registerAdminIntegrationRoutes } from './routes/admin-integrations.js';
import { adminRoutes } from './routes/admin.js';
import { adminJobsRoutes } from './routes/admin-jobs.js';
import { adminOrganizationRoutes } from './routes/admin-organizations.js';
import { invitationRoutes } from './routes/invitations.js';
import { organizationRequestRoutes } from './routes/organization-requests.js';
import { adminOrganizationRequestRoutes } from './routes/admin-organization-requests.js';
import { OrgRequestEmailService } from '../saas/services/org-request-email.service.js';
import { intelligenceSettingsRoutes } from './routes/intelligence-settings.js';
import { intelligenceFeedbackRoutes } from './routes/intelligence-feedback.js';
import { intelligenceEnrichmentRoutes } from './routes/intelligence-enrichment.js';
import { intelligenceMitigationRoutes } from './routes/intelligence-mitigation.js';

const gunzipAsync = promisify(gunzip);
import { setupRoutes } from './routes/setup.js';
import { deploymentRoutes } from './routes/deployment.js';
import { userRoutes } from './routes/users.js';
import { analyticsRoutes } from './routes/analytics.js';
import { notificationRoutes } from './routes/notifications/index.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { permissionRoutes } from './routes/permissions.js';
import { logCriticalRedisError } from '../utils/redis-utils.js';
import type { RetentionService } from '../retention/retention-service.js';
import type { RetentionScheduler } from '../retention/retention-scheduler.js';
import type { QueueManager } from '../queue/queue-manager.js';
import type { IStorageService } from '../storage/types.js';
import type { PluginRegistry } from '../integrations/plugin-registry.js';
import { initializeDataResidency } from '../data-residency/config.js';
import { initializeDefaultStorage } from '../data-residency/regional-storage-router.js';
import { StorageService } from '../storage/storage-service.js';
import {
  createServiceContainer,
  createRequestContextMiddleware,
  type IServiceContainer,
} from '../container/index.js';

export interface ServerOptions {
  db: DatabaseClient;
  storage: IStorageService;
  pluginRegistry: PluginRegistry;
  retentionService?: RetentionService;
  retentionScheduler?: RetentionScheduler;
  queueManager?: QueueManager;
}

/**
 * Register tenant middleware for SaaS multi-tenancy
 * Only registers if deployment mode is SaaS
 */
async function registerTenantMiddleware(
  fastify: FastifyInstance,
  db: DatabaseClient
): Promise<void> {
  const { getDeploymentConfig, DEPLOYMENT_MODE } = await import('../saas/config.js');
  if (getDeploymentConfig().mode === DEPLOYMENT_MODE.SAAS) {
    const { createTenantMiddleware } = await import('../saas/middleware/tenant.js');
    fastify.addHook('onRequest', createTenantMiddleware(db));
  }
}

/**
 * Validate critical services before starting server
 */
async function validateServices(options: ServerOptions): Promise<void> {
  const logger = getLogger();

  // Validate database connection
  try {
    await options.db.testConnection();
    logger.info('✓ Database connection validated');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CRITICAL] Database connection failed during startup:', {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Database validation failed: ${errorMessage}`);
  }

  // Validate Redis connection if queue manager is provided
  if (options.queueManager) {
    try {
      const isHealthy = await options.queueManager.healthCheck();
      if (!isHealthy) {
        throw new Error('Redis health check returned false');
      }
      logger.info('✓ Redis connection validated');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logCriticalRedisError(errorMessage, process.env.REDIS_URL, 'startup');
      throw new Error(`Redis validation failed: ${errorMessage}`);
    }
  }

  // Validate storage if provided
  try {
    const isHealthy = await options.storage.healthCheck();
    if (!isHealthy) {
      throw new Error('Storage health check returned false');
    }
    logger.info('✓ Storage connection validated');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WARNING] Storage health check failed:', {
      error: errorMessage,
      timestamp: new Date().toISOString(),
      note: 'Server will start but file uploads may fail',
    });
    // Don't throw - storage issues shouldn't block startup
  }
}

/**
 * Create and configure Fastify server
 */
export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const { db } = options;
  const logger = getLogger();

  // Validate critical services before proceeding
  await validateServices(options);

  // Create service container for dependency injection
  const container: IServiceContainer = createServiceContainer({
    db: options.db,
    storage: options.storage,
    pluginRegistry: options.pluginRegistry,
    queueManager: options.queueManager,
    retentionService: options.retentionService,
    retentionScheduler: options.retentionScheduler,
  });

  logger.info('Service container initialized');

  // Initialize data residency configuration (regional storage env vars)
  initializeDataResidency();

  // Validate strict residency storage is configured
  // Only validate strict residency storage when using S3-based storage
  // Mock storage and LocalStorageService don't support regional storage
  if (options.storage instanceof StorageService) {
    const { validateStrictResidencyStorage } = await import('../data-residency/config.js');
    const validation = validateStrictResidencyStorage();

    // Log warnings for partially configured regions
    validation.warnings.forEach((warning) => logger.warn(warning));

    // Fail startup if strict residency regions have no storage configured
    if (!validation.valid) {
      const errorMsg = 'Strict data residency validation failed:\n' + validation.errors.join('\n');
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (validation.warnings.length === 0 && validation.errors.length === 0) {
      logger.info('Data residency storage validation passed');
    }
  }

  // Initialize default storage for regional routing (S3 only)
  if (options.storage instanceof StorageService) {
    const { client, bucket } = options.storage.getDefaultStorage();
    initializeDefaultStorage(client, bucket);
  } else {
    logger.debug('Default regional storage not initialized (non-S3 backend)');
  }

  // Create Fastify instance with logging
  const fastify = Fastify({
    logger: {
      level: config.server.logLevel,
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    // Global body size limit - protects against DoS attacks via large JSON payloads
    // Multipart uploads use separate limit (config.server.maxUploadSize)
    bodyLimit: REQUEST_BODY_LIMIT,
    genReqId: () => {
      return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    },
    ajv: {
      customOptions: {
        // Reject requests with extra properties when schema has additionalProperties: false
        // Default (true) silently strips extra properties, which can mask injection attempts
        removeAdditional: false,
      },
    },
  });

  // Attach container to Fastify instance for cleanup during shutdown
  fastify.decorate('container', container);

  // Register cookie plugin for httpOnly cookies
  await fastify.register(cookie, {
    secret: config.jwt.secret, // Sign cookies for additional security
    parseOptions: {},
  });

  // Register CORS plugin with wildcard pattern support
  // Convert user-friendly wildcard patterns (e.g., "https://*.example.com") to RegExp
  const corsOrigins = convertCorsOriginsToRegex(config.server.corsOrigins);
  await fastify.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Content-Encoding'],
    exposedHeaders: ['Content-Type', 'Content-Encoding'],
  });

  // Add content-type parser for gzipped payloads (DRY: shared decompression logic)
  const parseGzipPayload = async (_req: unknown, body: unknown) => {
    try {
      const decompressed = await gunzipAsync(body as Buffer);
      return JSON.parse(decompressed.toString('utf-8'));
    } catch (error) {
      throw new Error(
        `Failed to decompress gzipped payload: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  fastify.addContentTypeParser('application/gzip', { parseAs: 'buffer' }, parseGzipPayload);
  fastify.addContentTypeParser('application/x-gzip', { parseAs: 'buffer' }, parseGzipPayload);

  // Register Helmet for security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: config.server.cspImgSrc,
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    // HSTS: Enforce HTTPS for 1 year, include subdomains, allow preload list submission
    // Only enabled in production to avoid issues during local development
    strictTransportSecurity:
      config.server.env === 'production'
        ? {
            maxAge: 31536000, // 1 year in seconds
            includeSubDomains: true,
            preload: true,
          }
        : false,
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // Add Permissions-Policy header (not directly supported by Helmet)
  // Restricts access to browser features for enhanced security
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });

  // Register rate limiting
  await fastify.register(rateLimit, {
    max: process.env.NODE_ENV === 'test' ? 10000 : config.rateLimit.maxRequests,
    timeWindow: config.rateLimit.windowMs,
    hook: 'onRequest',
    errorResponseBuilder: (_request, _context) => {
      return {
        success: false,
        error: 'TooManyRequests',
        message: 'Rate limit exceeded. Please try again later',
        statusCode: 429,
        timestamp: new Date().toISOString(),
      };
    },
  });

  // Register JWT plugin
  if (config.jwt.secret) {
    await fastify.register(jwt, {
      secret: config.jwt.secret,
    });
  } else {
    logger.warn('JWT_SECRET not configured. JWT authentication will not work.');
  }

  // Register multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: config.server.maxUploadSize,
      files: 1,
    },
  });

  // Register Prometheus metrics plugin (request timing)
  await fastify.register(metricsPlugin);

  // Global hooks for request logging
  fastify.addHook('onRequest', async (request, _reply) => {
    request.log.info(
      {
        url: request.url,
        method: request.method,
        headers: {
          'user-agent': request.headers['user-agent'],
          'x-api-key': request.headers['x-api-key'] ? '[REDACTED]' : undefined,
          authorization: request.headers.authorization ? '[REDACTED]' : undefined,
        },
      },
      'Incoming request'
    );
  });

  fastify.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        url: request.url,
        method: request.method,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
  });

  // Register request context middleware (attaches services to req.ctx)
  // Runs after rate limiting and logging, but before auth middleware and routes
  // This ensures all route handlers and downstream middleware can access services via req.ctx
  const requestContextMiddleware = createRequestContextMiddleware(container);
  fastify.addHook('onRequest', requestContextMiddleware);

  // Register tenant middleware (resolves organization from subdomain in SaaS mode)
  await registerTenantMiddleware(fastify, db);

  // Register authentication middleware (before routes, runs early)
  const { createAuthMiddleware, createBodyAuthMiddleware } = await import('./middleware/auth.js');
  const authMiddleware = createAuthMiddleware(db);
  const bodyAuthMiddleware = createBodyAuthMiddleware(db);

  // onRequest: Check query params and headers (before body parsing)
  fastify.addHook('onRequest', authMiddleware);

  // preValidation: Check POST body for share tokens (after body parsing)
  fastify.addHook('preValidation', bodyAuthMiddleware);

  // Register audit logging middleware (after auth, logs admin actions)
  const { createAuditMiddleware } = await import('./middleware/audit.js');
  const auditMiddleware = createAuditMiddleware(db);
  fastify.addHook('onResponse', auditMiddleware);

  // Register routes (await async functions)
  await healthRoutes(fastify);
  await metricsRoutes(fastify);
  deploymentRoutes(fastify);

  // Register Prometheus gauge collectors for DB pool + queue depth
  registerGaugeCollectors(options.db, options.queueManager);

  // Register settings routes (requires API key authentication)
  const { settingsRoutes } = await import('./routes/settings.js');
  await settingsRoutes(fastify, db);

  // Get notification service from container (lazy-loaded)
  const notificationService = container.getNotificationService();

  bugReportRoutes(
    fastify,
    db,
    options.storage,
    notificationService,
    options.queueManager,
    options.pluginRegistry
  );
  shareTokenRoutes(fastify, db, options.storage);
  projectRoutes(fastify, db);
  projectMemberRoutes(fastify, db);
  projectIntegrationRoutes(fastify, db, options.pluginRegistry);
  authRoutes(fastify, db);
  signupRoutes(fastify, db);
  await adminRoutes(fastify, db, options.pluginRegistry);
  await adminJobsRoutes(fastify);
  await setupRoutes(fastify, db);
  userRoutes(fastify, db.users);
  apiKeyRoutes(fastify, db);
  permissionRoutes(fastify, db);
  analyticsRoutes(fastify, db.analytics, db);

  // Register upload routes (presigned URL generation and confirmation)
  const { uploadsRoutes } = await import('./routes/uploads.js');
  if (options.queueManager) {
    uploadsRoutes(fastify, db, options.storage, options.queueManager);
  } else {
    logger.warn('Queue manager not provided - upload routes will have limited functionality');
  }

  // Register audit log routes
  const { auditLogRoutes } = await import('./routes/audit-logs.js');
  auditLogRoutes(fastify, db);

  // Register storage URL generation routes
  const { storageUrlRoutes } = await import('./routes/storage-urls.js');
  storageUrlRoutes(fastify, db, options.storage);

  // Register screenshot proxy routes (clean URLs for screenshots)
  const { registerScreenshotRoutes } = await import('./routes/screenshots.js');
  await registerScreenshotRoutes(fastify, db, options.storage);

  // Register notification routes
  notificationRoutes(fastify, db);

  // Register job/queue routes if queue manager is provided
  logger.info('Checking queue manager for job routes', {
    queueManagerProvided: !!options.queueManager,
    queueManagerType: options.queueManager ? typeof options.queueManager : 'undefined',
  });

  if (options.queueManager) {
    jobRoutes(fastify, db, options.queueManager);
  } else {
    logger.warn('Queue manager not provided - job routes will not be registered');
  }

  // Register retention routes if services are provided
  if (options.retentionService && options.retentionScheduler) {
    retentionRoutes(fastify, db, options.retentionService, options.retentionScheduler);
  }

  // Register data residency routes
  dataResidencyRoutes(fastify, db);
  organizationRoutes(fastify, db);
  adminOrganizationRoutes(fastify, db);
  invitationRoutes(fastify, db);
  billingRoutes(fastify, db);

  // Initialize billing region registry with KZ plugin
  // TODO: Refactor to dynamic plugin loading when more regions are added
  const billingRegistry = new BillingRegionRegistry();
  billingRegistry.register(new KzBillingPlugin());
  invoiceBillingRoutes(fastify, db, billingRegistry);

  intelligenceSettingsRoutes(fastify, db);
  intelligenceFeedbackRoutes(fastify, db);
  intelligenceEnrichmentRoutes(fastify, db, options.queueManager);
  intelligenceMitigationRoutes(fastify, db, options.queueManager);

  // Register organization request routes (public + admin)
  const orgRequestEmailService = new OrgRequestEmailService();
  organizationRequestRoutes(fastify, db, orgRequestEmailService);
  adminOrganizationRequestRoutes(fastify, db, orgRequestEmailService);

  // Register integration routes
  await registerIntegrationRoutes(fastify, db, options.pluginRegistry);

  // Register integration rules routes
  await registerIntegrationRuleRoutes(fastify, db, options.pluginRegistry);

  // Register admin integration management routes
  await registerAdminIntegrationRoutes(fastify, db, options.pluginRegistry);

  // Register error handlers
  fastify.setErrorHandler(errorHandler);
  fastify.setNotFoundHandler(notFoundHandler);

  // Wire up intelligence integration (no-op when INTELLIGENCE_ENABLED != true)
  const { setupIntelligence } = await import('../plugins/intelligence.plugin.js');
  await setupIntelligence(fastify);

  // Wire up self-service resolution routes (depends on intelligence being enabled)
  const { setupSelfService } = await import('../plugins/self-service.plugin.js');
  await setupSelfService(fastify);

  // Root endpoint (public)
  fastify.get('/', { config: { public: true } }, async (_request, reply) => {
    return reply.send({
      name: 'BugSpotter API',
      version: '1.0.0',
      status: 'running',
      documentation: '/api/v1/docs',
      timestamp: new Date().toISOString(),
    });
  });

  return fastify;
}

/**
 * Start the Fastify server
 */
export async function startServer(fastify: FastifyInstance): Promise<void> {
  const logger = getLogger();

  try {
    const address = await fastify.listen({
      port: config.server.port,
      host: '0.0.0.0', // Listen on all interfaces for Docker compatibility
    });

    logger.info('BugSpotter API Server started successfully');
    logger.info(`Listening on port ${config.server.port}`);
    logger.info(`Environment: ${config.server.env}`);
    logger.info(`Storage backend: ${config.storage.backend}`);
    logger.info(`Address: ${address}`);

    if (config.server.env === 'development') {
      logger.info(`Local URL: http://localhost:${config.server.port}`);
      logger.info(`Network URL: http://0.0.0.0:${config.server.port}`);
    }

    logger.info('Server details', {
      address,
      port: config.server.port,
      host: '0.0.0.0',
      env: config.server.env,
      nodeEnv: process.env.NODE_ENV || 'development',
      storage: config.storage.backend,
      corsOrigins: config.server.corsOrigins,
    });

    // Best-effort SMTP check — log result without blocking startup
    new InvitationEmailService().verifyConnection().catch(() => {});
  } catch (error) {
    logger.error('Failed to start server', { error });
    throw error;
  }
}

/**
 * Gracefully shutdown the server
 */
export async function shutdownServer(fastify: FastifyInstance): Promise<void> {
  const logger = getLogger();

  logger.info('Shutting down server...');

  try {
    // Stop accepting new requests
    await fastify.close();
    logger.info('Server closed');

    // Dispose of service container (closes all services)
    const container = (fastify as FastifyInstance & { container: IServiceContainer }).container;
    if (container) {
      await container.dispose();
      logger.info('Service container disposed');
    } else {
      logger.warn('Service container not found on Fastify instance');
    }

    logger.info('Shutdown complete');
  } catch (error) {
    logger.error('Error during shutdown', { error });
    throw error;
  }
}
