/**
 * GET /api/v1/bugs/:id/mitigations
 * Returns mitigation suggestions, applying an optional per-org similarity threshold.
 * Mirrors the threshold acceptance/validation behaviour of the similar-bugs endpoint.
 */

import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { AppError } from '../../middleware/error.js';
import { getLogger } from '../../logger.js';

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

const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 1.0;

function resolveThreshold(rawQueryThreshold: number | undefined): number {
  const envDefault = Number(process.env.SIMILARITY_THRESHOLD ?? '0.85');

  if (rawQueryThreshold === undefined) {
    return envDefault;
  }

  if (isNaN(rawQueryThreshold)) {
    throw new AppError('threshold must be a number between 0.5 and 1.0', 422);
  }

  if (rawQueryThreshold < THRESHOLD_MIN || rawQueryThreshold > THRESHOLD_MAX) {
    throw new AppError(`threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}`, 422);
  }

  return rawQueryThreshold;
}

export default async function mitigationsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error, request, reply) => {
    if (error.validation && error.validationContext === 'querystring') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
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
    '/api/v1/bugs/:id/mitigations',
    {
      schema: {
        params: paramsSchema,
        querystring: querystringSchema,
      },
    },
    async (request, reply) => {
      const { id: bugId } = request.params;
      const threshold = resolveThreshold(request.query.threshold);

      logger.debug({ bugId, threshold }, 'mitigations: computing with threshold');

      // TODO: replace with your actual MitigationService call, e.g.:
      // const results = await mitigationService.findMitigations(bugId, { threshold });
      const results: unknown[] = [];

      return reply.send(results);
    }
  );
}
