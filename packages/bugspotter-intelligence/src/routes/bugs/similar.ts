/**
 * GET /api/v1/bugs/:id/similar
 * Returns similar bugs, applying an optional per-org similarity threshold.
 */

import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { AppError } from '../../middleware/error.js';
import { getLogger } from '../../logger.js';

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

const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 1.0;

/**
 * Validate and resolve the effective similarity threshold.
 * Returns the query-param value when present and valid, the env default otherwise.
 * Throws AppError(422) for out-of-range or non-numeric values.
 */
function resolveThreshold(rawQueryThreshold: number | undefined): number {
  const envDefault = Number(process.env.SIMILARITY_THRESHOLD ?? '0.85');

  if (rawQueryThreshold === undefined) {
    return envDefault;
  }

  // AJV coercion from a string query param may yield NaN if the value is non-numeric
  if (isNaN(rawQueryThreshold)) {
    throw new AppError('threshold must be a number between 0.5 and 1.0', 422);
  }

  if (rawQueryThreshold < THRESHOLD_MIN || rawQueryThreshold > THRESHOLD_MAX) {
    throw new AppError(`threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}`, 422);
  }

  return rawQueryThreshold;
}

export default async function similarBugsRoute(fastify: FastifyInstance): Promise<void> {
  // Override Fastify's default 400 schema validation error to 422 for querystring violations
  fastify.setErrorHandler((error, request, reply) => {
    if (error.validation && error.validationContext === 'querystring') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    // Re-throw AppError instances so the global handler picks them up
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    return reply.send(error);
  });

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
