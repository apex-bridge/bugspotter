/**
 * Intelligence API Routes
 * Proxies requests to bugspotter-intelligence, forwarding per-org settings.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';
import { IntelligenceClient } from '../../services/intelligence/intelligence-client.js';
import { AppError } from '../middleware/error.js';

const logger = getLogger();

// TODO: confirm the exact shape of the org settings type used in your auth middleware
interface OrgSettings {
  intelligence_similarity_threshold?: number | null;
  [key: string]: unknown;
}

// TODO: confirm the request extension shape set by your auth/tenant middleware
interface AuthedRequest extends FastifyRequest {
  org: {
    id: string;
    settings: OrgSettings;
  };
}

interface BugParams {
  id: string;
}

export default async function intelligenceRoutes(
  fastify: FastifyInstance,
  _options: { db: DatabaseClient }
): Promise<void> {
  // TODO: resolve INTELLIGENCE_SERVICE_URL from your config module rather than env directly
  const intelligenceBaseUrl = process.env.INTELLIGENCE_SERVICE_URL ?? 'http://intelligence:8000';
  const client = new IntelligenceClient(intelligenceBaseUrl);

  /**
   * Resolve the per-org similarity threshold from the already-fetched org settings.
   * Returns undefined when unset so the downstream service applies its own default.
   */
  function resolveThreshold(settings: OrgSettings): number | undefined {
    const val = settings.intelligence_similarity_threshold;
    return typeof val === 'number' ? val : undefined;
  }

  fastify.get<{ Params: BugParams }>(
    '/v1/bugs/:id/similar',
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest<{ Params: BugParams }>, reply: FastifyReply) => {
      const authed = request as unknown as AuthedRequest;
      const { id: bugId } = request.params;

      if (!authed.org) {
        throw new AppError('Org context not available', 500);
      }

      const similarityThreshold = resolveThreshold(authed.org.settings);

      logger.debug(
        { bugId, orgId: authed.org.id, similarityThreshold },
        'intelligence: forwarding similar-bugs request'
      );

      const results = await client.getSimilarBugs(bugId, { similarityThreshold });
      return sendSuccess(reply, results);
    }
  );

  fastify.get<{ Params: BugParams }>(
    '/v1/bugs/:id/mitigations',
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest<{ Params: BugParams }>, reply: FastifyReply) => {
      const authed = request as unknown as AuthedRequest;
      const { id: bugId } = request.params;

      if (!authed.org) {
        throw new AppError('Org context not available', 500);
      }

      const similarityThreshold = resolveThreshold(authed.org.settings);

      logger.debug(
        { bugId, orgId: authed.org.id, similarityThreshold },
        'intelligence: forwarding mitigations request'
      );

      const results = await client.getMitigations(bugId, { similarityThreshold });
      return sendSuccess(reply, results);
    }
  );
}
