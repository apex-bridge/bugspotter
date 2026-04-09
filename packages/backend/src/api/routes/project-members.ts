/**
 * Project Member routes
 * Member management operations for projects
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { ProjectRole } from '../../types/project-roles.js';
import {
  listProjectMembersSchema,
  addProjectMemberSchema,
  updateProjectMemberSchema,
  removeProjectMemberSchema,
} from '../schemas/project-member-schema.js';
import { guard } from '../authorization/index.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { validateRole } from '../utils/authorization.js';
import { ProjectMemberService } from '../../services/project-member-service.js';

export function projectMemberRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const memberService = new ProjectMemberService(db);

  /**
   * GET /api/v1/projects/:id/members
   * List all members of a project
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/members',
    {
      schema: listProjectMembersSchema,
      preHandler: [guard(db, { auth: 'user', resource: { type: 'project' } })],
    },
    async (request, reply) => {
      const { id } = request.params;

      const members = await memberService.getMembers(id);

      return sendSuccess(reply, members);
    }
  );

  /**
   * POST /api/v1/projects/:id/members
   * Add a member to a project (requires project admin+ role)
   */
  fastify.post<{ Params: { id: string }; Body: { user_id: string; role: string } }>(
    '/api/v1/projects/:id/members',
    {
      schema: addProjectMemberSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'project' }, projectRole: 'admin' }),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { user_id, role } = request.body;

      // Validate role
      validateRole(role);

      const member = await memberService.addMember({
        projectId: id,
        targetUserId: user_id,
        requesterId: request.authUser!.id,
        role: role as ProjectRole,
        project: request.project!,
        requesterRole: request.projectRole,
      });

      return sendCreated(reply, member);
    }
  );

  /**
   * PATCH /api/v1/projects/:id/members/:userId
   * Update a project member's role (requires project admin+ role)
   */
  fastify.patch<{ Params: { id: string; userId: string }; Body: { role: string } }>(
    '/api/v1/projects/:id/members/:userId',
    {
      schema: updateProjectMemberSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'project' }, projectRole: 'admin' }),
      ],
    },
    async (request, reply) => {
      const { id, userId } = request.params;
      const { role } = request.body;

      // Validate role
      validateRole(role);

      const updated = await memberService.updateMemberRole({
        projectId: id,
        targetUserId: userId,
        requesterId: request.authUser!.id,
        newRole: role as ProjectRole,
        project: request.project!,
        requesterRole: request.projectRole,
      });

      return sendSuccess(reply, updated);
    }
  );

  /**
   * DELETE /api/v1/projects/:id/members/:userId
   * Remove a member from a project (requires project admin+ role)
   */
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/api/v1/projects/:id/members/:userId',
    {
      schema: removeProjectMemberSchema,
      preHandler: [
        guard(db, {
          auth: 'user',
          resource: { type: 'project' },
          projectRole: 'admin',
          action: 'manage',
        }),
      ],
    },
    async (request, reply) => {
      const { id, userId } = request.params;

      await memberService.removeMember({
        projectId: id,
        targetUserId: userId,
        requesterId: request.authUser!.id,
        project: request.project!,
        requesterRole: request.projectRole,
      });

      return reply.send({
        success: true,
        message: 'Member removed successfully',
      });
    }
  );
}
