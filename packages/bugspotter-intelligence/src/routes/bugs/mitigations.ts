/**
 * GET /api/v1/bugs/:id/mitigations
 * Returns mitigation suggestions, applying an optional per-org similarity threshold.
 * Mirrors the threshold acceptance/validation behaviour of the similar-bugs endpoint.
 */

import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { getLogger } from '../../logger.js';
import { resolveThreshold } from '../../utils/threshold.js';

// TODO: import from your actual mitigation service module
// import { MitigationService } from '../../services/mitigation.service.js';

const logger = getLogger();

const paramsSchema = Type.Object({
  id: Type.String(),
});

const querystringSchema = Type.Object({
  threshold: Type.Optional(Type.Number()),
});

type Params = Static<typeof paramsSchema>;
type Querystring = Static<typeof querystringSchema>;

export default async function mitigationsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: Params; Querystring: Querystring }>(
    '/api/v1/bugs/:id/mitigations',
    {
      schema: {
        params: paramsSchema,
        querystring: querystringSchema,
      },
    },
    async (request, reply) => {
      const { id: bugId } = request.params;

      // TODO: load per-org threshold from intelligence_settings before calling resolveThreshold:
      // const orgDefault = await orgSettingsService.getSimilarityThreshold(request.organizationId);
      const threshold = resolveThreshold(request.query.threshold /*, orgDefault */);

      logger.debug({ bugId, threshold }, 'mitigations: computing with threshold');

      // TODO: replace with your actual MitigationService call, e.g.:
      // const results = await mitigationService.findMitigations(bugId, { threshold });
      const results: unknown[] = [];

      return reply.send(results);
    }
  );
}
