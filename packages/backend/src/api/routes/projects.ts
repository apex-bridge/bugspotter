/**
 * Project routes
 * Core CRUD operations for projects
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import {
  createProjectSchema,
  getProjectSchema,
  updateProjectSchema,
  deleteProjectSchema,
} from '../schemas/project-schema.js';
import { requireUser, isPlatformAdmin } from '../middleware/auth.js';
import { guard } from '../authorization/index.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { AppError } from '../middleware/error.js';
import { OrganizationService } from '../../saas/services/organization.service.js';
import { getDeploymentConfig, DEPLOYMENT_MODE } from '../../saas/config.js';

interface CreateProjectBody {
  name: string;
  settings?: Record<string, unknown>;
  organization_id?: string;
}

interface UpdateProjectBody {
  name?: string;
  settings?: Record<string, unknown>;
}

/**
 * Resolve the organization_id for project creation.
 * - Org subdomain: tenant middleware already resolved the org
 * - Hub domain + SaaS mode: require org_id from body, verify membership
 * - Self-hosted: null (no org concept)
 */
async function resolveOrganizationForProject(
  request: FastifyRequest,
  bodyOrgId: string | undefined,
  db: DatabaseClient
): Promise<string | null> {
  // Org subdomain: tenant middleware already resolved and authorized the org
  if (request.organizationId) {
    return request.organizationId;
  }

  // Self-hosted mode: no org concept
  if (getDeploymentConfig().mode !== DEPLOYMENT_MODE.SAAS) {
    return null;
  }

  // Hub domain in SaaS mode: org_id required in body
  if (!bodyOrgId) {
    throw new AppError(
      'organization_id is required when creating projects from the hub domain',
      400,
      'ValidationError'
    );
  }

  // Validate org exists and user has access
  const { organization, membership } = await db.organizationMembers.checkOrganizationAccess(
    bodyOrgId,
    request.authUser!.id
  );

  if (!organization) {
    throw new AppError(`Organization not found: ${bodyOrgId}`, 404, 'NotFound');
  }

  // Platform admins bypass membership check
  if (!membership && !isPlatformAdmin(request)) {
    throw new AppError('You are not a member of this organization', 403, 'Forbidden');
  }

  return bodyOrgId;
}

export function projectRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const orgService = new OrganizationService(db);
  /**
   * GET /api/v1/projects
   * Get all projects for the authenticated user
   */
  fastify.get(
    '/api/v1/projects',
    {
      preHandler: [requireUser],
    },
    async (request, reply) => {
      // Platform admin users see all projects (scoped to org in SaaS mode)
      if (isPlatformAdmin(request)) {
        const projects = await db.projects.findAll(request.organizationId);
        return sendSuccess(reply, projects);
      }

      // Regular users see projects they created or are members of
      const projects = await db.projects.getUserAccessibleProjects(
        request.authUser!.id,
        request.organizationId
      );
      return sendSuccess(reply, projects);
    }
  );

  /**
   * POST /api/v1/projects
   * Create a new project (requires admin or user role — viewers cannot create projects)
   */
  fastify.post<{ Body: CreateProjectBody }>(
    '/api/v1/projects',
    {
      schema: createProjectSchema,
      preHandler: [requireUser],
    },
    async (request, reply) => {
      if (!isPlatformAdmin(request) && request.authUser?.role === 'viewer') {
        throw new AppError('Viewers cannot create projects', 403, 'Forbidden');
      }
      const { name, settings, organization_id: bodyOrgId } = request.body;
      const organizationId = await resolveOrganizationForProject(request, bodyOrgId, db);

      const projectInput = {
        name,
        settings: settings ?? {},
        created_by: request.authUser?.id,
        organization_id: organizationId,
      };

      // For SaaS orgs, use atomic quota check + insert to prevent race conditions.
      // For self-hosted (no organizationId), create directly without quota checks.
      const project = organizationId
        ? await orgService.createProjectWithQuotaCheck(organizationId, projectInput)
        : await db.projects.create(projectInput);

      return sendCreated(reply, project);
    }
  );

  /**
   * GET /api/v1/projects/:id
   * Get a project by ID
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id',
    {
      schema: getProjectSchema,
      preHandler: [guard(db, { auth: 'user', resource: { type: 'project' } })],
    },
    async (request, reply) => {
      // Project already validated and attached by middleware
      return sendSuccess(reply, request.project);
    }
  );

  /**
   * PATCH /api/v1/projects/:id
   * Update a project (requires project admin+ role)
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/api/v1/projects/:id',
    {
      schema: updateProjectSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'project' }, projectRole: 'admin' }),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      // Update the project (already validated by middleware)
      const updated = await db.projects.update(id, updates);

      return sendSuccess(reply, updated);
    }
  );

  /**
   * DELETE /api/v1/projects/:id
   * Delete a project (requires project owner or system admin)
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/projects/:id',
    {
      schema: deleteProjectSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'project' }, projectRole: 'owner' }),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;

      // Delete the project (already validated by middleware)
      await db.projects.delete(id);

      request.log.info({ project_id: id, user_id: request.authUser?.id }, 'Project deleted');

      return sendSuccess(reply, { message: 'Project deleted successfully' });
    }
  );
}
