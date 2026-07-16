/**
 * GET /api/v1/bugs/:id/similar
 * Returns similar bugs, applying an optional per-org similarity threshold.
 */

import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { getLogger } from '../../logger.js';
import { resolveThreshold, registerThresholdErrorHandler } from '../../utils/threshold.js';

// TODO: import from your actual similarity service module
// import { SimilarityService } from '../../services/similarity.service.js';

const logger = getLogger();

const paramsSchema = Type.Object({
  id: Type.String(),
});

const querystringSchema = Type.Object({
  threshold: Type.Optional(Type.Number()),
});

type Params = Static<typeof paramsSchema>;
type Querystring = Static<typeof querystringSchema>;

export default async function similarBugsRoute(fastify: FastifyInstance): Promise<void> {
  registerThresholdErrorHandler(fastify);

  fastify.get<{ Params: Params; Querystring: Querystring }>(
    '/api/v1/bugs/:id/similar',
    {
      schema: {
        params: paramsSchema,
        querystring: querystringSchema,
      },
    },
    async (request, reply) => {
      const { id: bugId } = request.params;
      const threshold = resolveThreshold(request.query.threshold);

      logger.debug({ bugId, threshold }, 'similar-bugs: computing with threshold');

      // TODO: replace with your actual SimilarityService call, e.g.:
      // const results = await similarityService.findSimilar(bugId, { threshold });
      const results: unknown[] = [];

      return reply.send(results);
    }
  );
}
