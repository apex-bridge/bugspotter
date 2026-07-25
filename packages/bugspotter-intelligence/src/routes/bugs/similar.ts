import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors.js';

export default async function similarRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/v1/bugs/:id/similar',
    {
      preHandler: async (request) => {
        const authHeader = request.headers.authorization;
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length)
          : undefined;
        if (!token) {
          throw new AppError('Unauthorized', 401);
        }
        let tenantId: string;
        try {
          ({ tenantId } = (request.server as any).authService.verifyToken(token));
        } catch {
          throw new AppError('Unauthorized', 401);
        }
        const bug = await (request.server as any).similarityService.getBugById(
          (request.params as { id: string }).id
        );
        if (!bug || bug.tenantId !== tenantId) {
          throw new AppError('Forbidden', 403);
        }
      },
    },
    async (request, reply) => {
      const response = await (request.server as any).similarityService.findSimilar(
        (request.params as { id: string }).id
      );
      return reply.send(response);
    }
  );
}
