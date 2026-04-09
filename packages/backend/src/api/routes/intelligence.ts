/**
 * Intelligence routes
 * Proxy endpoints for the bugspotter-intelligence service.
 * Requires authentication (JWT or API key) and project access.
 * The intelligence API key is managed server-side, not exposed to clients.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { guard } from '../authorization/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../middleware/error.js';
import type { IntelligenceClient } from '../../services/intelligence/intelligence-client.js';
import { IntelligenceError } from '../../services/intelligence/intelligence-client.js';
import type { IntelligenceClientFactory } from '../../services/intelligence/tenant-config.js';
import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/** Max items per intelligence search/similar query */
const MAX_LIMIT = 50;

/** Remap upstream status codes to avoid leaking internal semantics to clients */
const UPSTREAM_STATUS_CODE_MAP: Record<number, number> = {
  401: 502, // backend's API key issue, not client's auth
  403: 502,
  429: 503, // upstream rate limiting
};

// ============================================================================
// Schemas
// ============================================================================

const projectIdParam = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
  },
} as const;

const bugIdParam = {
  type: 'object',
  required: ['projectId', 'id'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const similarBugsSchema = {
  params: bugIdParam,
  querystring: {
    type: 'object',
    properties: {
      threshold: { type: 'number', minimum: 0, maximum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
} as const;

const searchSchema = {
  params: projectIdParam,
  body: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1000 },
      mode: { type: 'string', enum: ['fast', 'smart'] },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
      offset: { type: 'integer', minimum: 0 },
      status: { type: 'string', nullable: true },
      date_from: { type: 'string', format: 'date-time', nullable: true },
      date_to: { type: 'string', format: 'date-time', nullable: true },
    },
    additionalProperties: false,
  },
} as const;

const askSchema = {
  params: projectIdParam,
  body: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1, maxLength: 2000 },
      context: { type: 'array', items: { type: 'string' }, nullable: true },
      temperature: { type: 'number', minimum: 0, maximum: 2 },
      max_tokens: { type: 'integer', minimum: 1, maximum: 4096 },
    },
    additionalProperties: false,
  },
} as const;

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Execute an intelligence service call with standardized error mapping.
 * Reduces try/catch duplication across route handlers.
 */
async function handleIntelligenceRequest<T>(
  client: IntelligenceClient,
  fn: (client: IntelligenceClient) => Promise<T>
): Promise<T> {
  try {
    return await fn(client);
  } catch (error) {
    throw mapIntelligenceError(error);
  }
}

/**
 * Resolve the IntelligenceClient for a request.
 * - When a factory and org context exist, uses the per-org client (tenant-scoped).
 * - Falls back to global client only when no org context (self-hosted) or no factory (backward compat).
 * - Throws 503 when org context exists but no per-org client is available.
 */
async function resolveClient(
  request: { project?: { organization_id?: string | null } },
  clientFactory: IntelligenceClientFactory | undefined,
  globalClient: IntelligenceClient
): Promise<IntelligenceClient> {
  const orgId = request.project?.organization_id;

  if (clientFactory && orgId) {
    try {
      const orgClient = await clientFactory.getClientForOrg(orgId);
      if (orgClient) {
        return orgClient;
      }
    } catch (error) {
      logger.error('Failed to resolve per-org intelligence client', {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Intelligence service temporarily unavailable', 503, 'ServiceUnavailable');
    }
    // orgClient is null — intelligence not configured for this org
    throw new AppError(
      'Intelligence is not configured for this organization',
      503,
      'ServiceUnavailable'
    );
  }

  return globalClient;
}

export function intelligenceRoutes(
  fastify: FastifyInstance,
  intelligenceClient: IntelligenceClient,
  db?: DatabaseClient,
  clientFactory?: IntelligenceClientFactory
) {
  /**
   * GET /api/v1/intelligence/health
   * Check intelligence service availability and circuit breaker state
   */
  fastify.get(
    '/api/v1/intelligence/health',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const healthy = await intelligenceClient.healthCheck();
      const circuit = intelligenceClient.getCircuitState();

      return sendSuccess(reply, { enabled: true, healthy, circuit });
    }
  );

  // Project-scoped routes require db for access checks
  if (!db) {
    logger.warn(
      'Intelligence routes: database client not available, skipping project-scoped routes'
    );
    return;
  }

  // TODO: Verify bug ID belongs to projectId before proxying to intelligence service.
  // Deferred to R2 when bug analysis sync establishes the ownership link.

  /**
   * GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar
   * Find similar bugs for a given bug report
   */
  fastify.get<{
    Params: { projectId: string; id: string };
    Querystring: { threshold?: number; limit?: number };
  }>(
    '/api/v1/intelligence/projects/:projectId/bugs/:id/similar',
    {
      schema: similarBugsSchema,
      preHandler: [
        guard(db, { auth: 'userOrApiKey', resource: { type: 'project', paramName: 'projectId' } }),
      ],
    },
    async (request, reply) => {
      const { projectId, id } = request.params;
      const { threshold, limit } = request.query;
      const client = await resolveClient(request, clientFactory, intelligenceClient);

      const result = await handleIntelligenceRequest(client, (c) =>
        c.getSimilarBugs(id, { threshold, limit, projectId })
      );
      return sendSuccess(reply, result);
    }
  );

  // NOTE: Mitigation (Suggest Fix) endpoint moved to intelligence-mitigation.ts
  // It now uses an async pipeline: POST triggers job → worker calls LLM → saves to DB → GET reads cache.

  /**
   * POST /api/v1/intelligence/projects/:projectId/search
   * Natural language search across bugs within a project
   */
  fastify.post<{
    Params: { projectId: string };
    Body: {
      query: string;
      mode?: 'fast' | 'smart';
      limit?: number;
      offset?: number;
      status?: string | null;
      date_from?: string | null;
      date_to?: string | null;
    };
  }>(
    '/api/v1/intelligence/projects/:projectId/search',
    {
      schema: searchSchema,
      preHandler: [
        guard(db, {
          auth: 'userOrApiKey',
          resource: { type: 'project', paramName: 'projectId' },
          action: 'read',
        }),
      ],
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { query, mode, limit, offset, status, date_from, date_to } = request.body;

      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        throw new AppError(
          'Query cannot be empty or contain only whitespace',
          400,
          'ValidationError'
        );
      }

      const client = await resolveClient(request, clientFactory, intelligenceClient);
      const result = await handleIntelligenceRequest(client, (c) =>
        c.search({
          query: trimmedQuery,
          project_id: projectId,
          mode: mode ?? 'fast',
          limit: limit ?? 10,
          offset: offset ?? 0,
          status: status ?? null,
          date_from: date_from ?? null,
          date_to: date_to ?? null,
        })
      );
      return sendSuccess(reply, result);
    }
  );

  /**
   * POST /api/v1/intelligence/projects/:projectId/ask
   * General Q&A with LLM + bug database context
   */
  fastify.post<{
    Params: { projectId: string };
    Body: {
      question: string;
      context?: string[] | null;
      temperature?: number;
      max_tokens?: number;
    };
  }>(
    '/api/v1/intelligence/projects/:projectId/ask',
    {
      schema: askSchema,
      preHandler: [
        guard(db, {
          auth: 'userOrApiKey',
          resource: { type: 'project', paramName: 'projectId' },
          action: 'read',
        }),
      ],
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { question, context, temperature, max_tokens } = request.body;

      const trimmedQuestion = question.trim();
      if (!trimmedQuestion) {
        throw new AppError(
          'Question cannot be empty or contain only whitespace',
          400,
          'ValidationError'
        );
      }

      const client = await resolveClient(request, clientFactory, intelligenceClient);
      const result = await handleIntelligenceRequest(client, (c) =>
        c.ask({
          question: trimmedQuestion,
          project_id: projectId,
          context: context ?? null,
          temperature: temperature ?? 0.7,
          max_tokens: max_tokens ?? 500,
        })
      );
      return sendSuccess(reply, result);
    }
  );

  logger.info('Intelligence routes registered');
}

/**
 * Map IntelligenceError to AppError for consistent error responses
 */
function mapIntelligenceError(error: unknown): AppError {
  if (error instanceof IntelligenceError) {
    if (error.code === 'circuit_open') {
      return new AppError(
        'Intelligence service is temporarily unavailable',
        503,
        'ServiceUnavailable'
      );
    }
    // Log full upstream detail server-side, return generic message to client
    logger.error('Intelligence service error', {
      code: error.code,
      statusCode: error.statusCode,
      detail: error.message,
    });
    // Map upstream codes: explicit overrides first, then 5xx → 503, everything else → 502.
    // Upstream 4xx are backend-internal issues (bad request to our dependency), not client errors.
    const status =
      UPSTREAM_STATUS_CODE_MAP[error.statusCode] ??
      (error.statusCode >= 500 && error.statusCode < 600 ? 503 : 502);
    const clientMessage =
      error.code === 'network_error'
        ? 'Intelligence service is unreachable'
        : 'Intelligence service is temporarily unavailable';
    return new AppError(clientMessage, status, 'IntelligenceError');
  }

  if (error instanceof AppError) {
    return error;
  }

  logger.error('Unexpected intelligence error', {
    error: error instanceof Error ? error.message : String(error),
  });
  return new AppError('Intelligence service error', 502, 'BadGateway');
}
