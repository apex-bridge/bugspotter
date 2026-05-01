/**
 * RBAC Regression Tests
 * Comprehensive access control matrix testing for all roles × endpoints.
 *
 * Tests that every combination of:
 *   - System role (admin, user, viewer, unauthenticated)
 *   - Project role (owner, admin, member, viewer, none)
 *   - Auth method (JWT, API key, none)
 * produces the correct allow/deny result for each protected endpoint.
 *
 * These are unit tests that exercise the actual middleware functions
 * with mock requests — no database or HTTP server needed.
 */

import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('../../../src/api/middleware/auth/responses.js', () => ({
  sendUnauthorized: vi.fn((reply, message) => {
    reply.code(401);
    return reply.send({ statusCode: 401, error: 'Unauthorized', message });
  }),
  sendForbidden: vi.fn((reply, message) => {
    reply.code(403);
    return reply.send({ statusCode: 403, error: 'Forbidden', message });
  }),
  sendRateLimitExceeded: vi.fn(),
  sendInternalError: vi.fn(),
}));

// Import actual middleware after mocks
import {
  requireRole,
  requireUser,
  requireAuth,
  requirePermission,
  requireProjectRole,
  requireApiKeyPermission,
} from '../../../src/api/middleware/auth/authorization.js';

// ============================================================================
// HELPERS
// ============================================================================

type SystemRole = 'admin' | 'user' | 'viewer';
type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer';

interface MockRequestConfig {
  systemRole?: SystemRole;
  projectRole?: ProjectRole;
  hasApiKey?: boolean;
  hasProjectScopedApiKey?: boolean;
}

function createRequest(config: MockRequestConfig = {}): FastifyRequest {
  return {
    authUser: config.systemRole
      ? {
          id: `${config.systemRole}-1`,
          email: `${config.systemRole}@test.com`,
          role: config.systemRole,
        }
      : undefined,
    projectRole: config.projectRole,
    authProject: config.hasProjectScopedApiKey ? { id: 'project-1' } : undefined,
    apiKey: config.hasApiKey ? { id: 'key-1', allowed_projects: ['project-1'] } : undefined,
  } as unknown as FastifyRequest;
}

function createReply(): FastifyReply & { _statusCode?: number } {
  const reply = {
    code: vi.fn(function (this: any, code: number) {
      this._statusCode = code;
      return this;
    }),
    send: vi.fn().mockReturnThis(),
    _statusCode: undefined as number | undefined,
  };
  return reply as unknown as FastifyReply & { _statusCode?: number };
}

async function runMiddleware(
  middleware: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
  config: MockRequestConfig
): Promise<{ allowed: boolean; statusCode?: number }> {
  const request = createRequest(config);
  const reply = createReply();
  await middleware(request, reply);

  if ((reply as any).code.mock.calls.length === 0) {
    return { allowed: true };
  }
  return { allowed: false, statusCode: (reply as any)._statusCode };
}

// ============================================================================
// requireUser — JWT authentication
// ============================================================================

describe('requireUser regression', () => {
  const cases: Array<[string, MockRequestConfig, boolean]> = [
    ['admin', { systemRole: 'admin' }, true],
    ['user', { systemRole: 'user' }, true],
    ['viewer', { systemRole: 'viewer' }, true],
    ['API key only', { hasApiKey: true }, false],
    ['unauthenticated', {}, false],
  ];

  it.each(cases)('%s → %s', async (_label, config, shouldAllow) => {
    const result = await runMiddleware(requireUser, config);
    expect(result.allowed).toBe(shouldAllow);
    if (!shouldAllow) {
      expect(result.statusCode).toBe(401);
    }
  });
});

// ============================================================================
// requireAuth — JWT or API key
// ============================================================================

describe('requireAuth regression', () => {
  const cases: Array<[string, MockRequestConfig, boolean]> = [
    ['admin', { systemRole: 'admin' }, true],
    ['user', { systemRole: 'user' }, true],
    ['viewer', { systemRole: 'viewer' }, true],
    ['API key only', { hasApiKey: true }, true],
    ['project-scoped API key', { hasProjectScopedApiKey: true }, true],
    ['unauthenticated', {}, false],
  ];

  it.each(cases)('%s → %s', async (_label, config, shouldAllow) => {
    const result = await runMiddleware(requireAuth, config);
    expect(result.allowed).toBe(shouldAllow);
    if (!shouldAllow) {
      expect(result.statusCode).toBe(401);
    }
  });
});

// ============================================================================
// requireRole — system role gating
// ============================================================================

describe('requireRole regression', () => {
  describe('requireRole(admin) — admin-only routes', () => {
    const middleware = requireRole('admin');
    const cases: Array<[string, MockRequestConfig, boolean]> = [
      ['admin', { systemRole: 'admin' }, true],
      ['user', { systemRole: 'user' }, false],
      ['viewer', { systemRole: 'viewer' }, false],
      ['unauthenticated', {}, false],
    ];

    it.each(cases)('%s → allowed=%s', async (_label, config, shouldAllow) => {
      const result = await runMiddleware(middleware, config);
      expect(result.allowed).toBe(shouldAllow);
    });
  });

  describe('requireRole(admin, user) — blocks viewers', () => {
    const middleware = requireRole('admin', 'user');
    const cases: Array<[string, MockRequestConfig, boolean]> = [
      ['admin', { systemRole: 'admin' }, true],
      ['user', { systemRole: 'user' }, true],
      ['viewer', { systemRole: 'viewer' }, false],
      ['unauthenticated', {}, false],
    ];

    it.each(cases)('%s → allowed=%s', async (_label, config, shouldAllow) => {
      const result = await runMiddleware(middleware, config);
      expect(result.allowed).toBe(shouldAllow);
      if (!shouldAllow && config.systemRole) {
        expect(result.statusCode).toBe(403);
      }
      if (!shouldAllow && !config.systemRole) {
        expect(result.statusCode).toBe(401);
      }
    });
  });
});

// ============================================================================
// requireProjectRole — project-level role hierarchy
// ============================================================================

describe('requireProjectRole regression', () => {
  const requiredRoles: ProjectRole[] = ['owner', 'admin', 'member', 'viewer'];
  const projectRoles: ProjectRole[] = ['owner', 'admin', 'member', 'viewer'];
  const HIERARCHY: Record<ProjectRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

  describe.each(requiredRoles)('requireProjectRole(%s)', (required) => {
    // System admin always passes
    it('system admin bypasses regardless of project role', async () => {
      const result = await runMiddleware(requireProjectRole(required), {
        systemRole: 'admin',
      });
      expect(result.allowed).toBe(true);
    });

    // Project-scoped API key always passes (API keys bypass role checks)
    it('project-scoped API key bypasses role check', async () => {
      const result = await runMiddleware(requireProjectRole(required), {
        hasProjectScopedApiKey: true,
      });
      expect(result.allowed).toBe(true);
    });

    // Full-scope API key always passes
    it('full-scope API key bypasses role check', async () => {
      const result = await runMiddleware(requireProjectRole(required), {
        hasApiKey: true,
      });
      expect(result.allowed).toBe(true);
    });

    // Unauthenticated always fails
    it('unauthenticated returns 401', async () => {
      const result = await runMiddleware(requireProjectRole(required), {});
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    // JWT user with no project role fails
    it('JWT user with no project role returns 403', async () => {
      const result = await runMiddleware(requireProjectRole(required), {
        systemRole: 'user',
      });
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    // Full matrix of project roles for JWT users
    describe.each(projectRoles)('JWT user with project role %s', (projectRole) => {
      const shouldAllow = HIERARCHY[projectRole] >= HIERARCHY[required];

      it(`system user → ${shouldAllow ? 'ALLOW' : 'DENY'}`, async () => {
        const result = await runMiddleware(requireProjectRole(required), {
          systemRole: 'user',
          projectRole,
        });
        expect(result.allowed).toBe(shouldAllow);
      });

      it(`system viewer → ${shouldAllow ? 'ALLOW' : 'DENY'}`, async () => {
        const result = await runMiddleware(requireProjectRole(required), {
          systemRole: 'viewer',
          projectRole,
        });
        expect(result.allowed).toBe(shouldAllow);
      });
    });

    // JWT user + API key: JWT takes precedence
    it('JWT user + API key → JWT role is enforced (no API key bypass)', async () => {
      const result = await runMiddleware(requireProjectRole(required), {
        systemRole: 'user',
        hasApiKey: true,
        projectRole: 'viewer',
      });
      // viewer < any required role except viewer
      const shouldAllow = HIERARCHY['viewer'] >= HIERARCHY[required];
      expect(result.allowed).toBe(shouldAllow);
    });
  });
});

// ============================================================================
// ROUTE-LEVEL SCENARIOS
// Simulate the full middleware chain for specific endpoints
// ============================================================================

describe('Route-level access control scenarios', () => {
  /**
   * Simulate running a middleware chain (like preHandler arrays).
   * Stops at the first middleware that sends a response.
   */
  async function runChain(
    middlewares: Array<(req: FastifyRequest, reply: FastifyReply) => Promise<void | FastifyReply>>,
    config: MockRequestConfig
  ): Promise<{ allowed: boolean; statusCode?: number }> {
    const request = createRequest(config);
    const reply = createReply();

    for (const mw of middlewares) {
      await mw(request, reply);
      // If middleware sent a response, stop
      if ((reply as any).code.mock.calls.length > 0) {
        return { allowed: false, statusCode: (reply as any)._statusCode };
      }
    }
    return { allowed: true };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/projects — requireUser + requireRole('admin', 'user')
  // --------------------------------------------------------------------------
  describe('POST /api/v1/projects (create project)', () => {
    const chain = [requireUser, requireRole('admin', 'user')];

    it.each([
      ['admin', true],
      ['user', true],
      ['viewer', false],
    ] as const)('system %s → allowed=%s', async (role, shouldAllow) => {
      const result = await runChain(chain, { systemRole: role });
      expect(result.allowed).toBe(shouldAllow);
    });

    it('unauthenticated → 401', async () => {
      const result = await runChain(chain, {});
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/v1/projects/:id — requireUser + requireProjectRole('owner')
  // --------------------------------------------------------------------------
  describe('DELETE /api/v1/projects/:id (delete project)', () => {
    // Note: requireProjectAccess is excluded since it requires DB
    const chain = [requireUser, requireProjectRole('owner')];

    it.each([
      ['admin', undefined, true], // system admin bypasses
      ['user', 'owner', true], // project owner
      ['user', 'admin', false], // project admin can't delete
      ['user', 'member', false],
      ['user', 'viewer', false],
      ['viewer', 'owner', true], // system viewer but project owner
    ] as const)('system=%s, project=%s → allowed=%s', async (sysRole, projRole, shouldAllow) => {
      const result = await runChain(chain, {
        systemRole: sysRole as SystemRole,
        projectRole: projRole as ProjectRole | undefined,
      });
      expect(result.allowed).toBe(shouldAllow);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/api-keys — requireUser + requireRole('admin', 'user')
  // --------------------------------------------------------------------------
  describe('POST /api/v1/api-keys (create API key)', () => {
    const chain = [requireUser, requireRole('admin', 'user')];

    it('viewer cannot create API keys', async () => {
      const result = await runChain(chain, { systemRole: 'viewer' });
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('user can create API keys', async () => {
      const result = await runChain(chain, { systemRole: 'user' });
      expect(result.allowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/v1/api-keys/:id — requireUser + requireRole('admin', 'user')
  // --------------------------------------------------------------------------
  describe('DELETE /api/v1/api-keys/:id (delete API key)', () => {
    const chain = [requireUser, requireRole('admin', 'user')];

    it('viewer cannot delete API keys', async () => {
      const result = await runChain(chain, { systemRole: 'viewer' });
      expect(result.allowed).toBe(false);
    });

    it('admin can delete API keys', async () => {
      const result = await runChain(chain, { systemRole: 'admin' });
      expect(result.allowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/projects/:id/members — requireUser + requireProjectRole('admin')
  // --------------------------------------------------------------------------
  describe('POST /api/v1/projects/:id/members (add member)', () => {
    const chain = [requireUser, requireProjectRole('admin')];

    it.each([
      ['admin', undefined, true], // system admin
      ['user', 'owner', true],
      ['user', 'admin', true],
      ['user', 'member', false],
      ['user', 'viewer', false],
      ['user', undefined, false],
    ] as const)('system=%s, project=%s → allowed=%s', async (sysRole, projRole, shouldAllow) => {
      const result = await runChain(chain, {
        systemRole: sysRole as SystemRole,
        projectRole: projRole as ProjectRole | undefined,
      });
      expect(result.allowed).toBe(shouldAllow);
    });
  });

  // --------------------------------------------------------------------------
  // Integration routes — requireAuth + requireProjectRole('admin')
  // These routes accept both JWT and API key auth
  // --------------------------------------------------------------------------
  describe('POST /api/v1/integrations/:platform/:projectId (save config)', () => {
    const chain = [requireAuth, requireProjectRole('admin')];

    it('system admin can save config', async () => {
      const result = await runChain(chain, { systemRole: 'admin' });
      expect(result.allowed).toBe(true);
    });

    it('project admin can save config', async () => {
      const result = await runChain(chain, { systemRole: 'user', projectRole: 'admin' });
      expect(result.allowed).toBe(true);
    });

    it('project viewer cannot save config', async () => {
      const result = await runChain(chain, { systemRole: 'user', projectRole: 'viewer' });
      expect(result.allowed).toBe(false);
    });

    it('API key can save config (bypasses role check)', async () => {
      const result = await runChain(chain, { hasApiKey: true });
      expect(result.allowed).toBe(true);
    });

    it('project-scoped API key can save config', async () => {
      const result = await runChain(chain, { hasProjectScopedApiKey: true });
      expect(result.allowed).toBe(true);
    });

    it('unauthenticated cannot save config', async () => {
      const result = await runChain(chain, {});
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Integration read — requireAuth (viewer-level, no role check)
  // --------------------------------------------------------------------------
  describe('GET /api/v1/integrations/:platform/:projectId (view config)', () => {
    const chain = [requireAuth];

    it('any authenticated user can view config', async () => {
      const result = await runChain(chain, { systemRole: 'viewer' });
      expect(result.allowed).toBe(true);
    });

    it('API key can view config', async () => {
      const result = await runChain(chain, { hasApiKey: true });
      expect(result.allowed).toBe(true);
    });

    it('unauthenticated cannot view config', async () => {
      const result = await runChain(chain, {});
      expect(result.allowed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Integration rules write — requireAuth + requireProjectRole('admin')
  // --------------------------------------------------------------------------
  describe('POST /api/v1/integrations/:platform/:projectId/rules (create rule)', () => {
    const chain = [requireAuth, requireProjectRole('admin')];

    it('project member cannot create rules', async () => {
      const result = await runChain(chain, { systemRole: 'user', projectRole: 'member' });
      expect(result.allowed).toBe(false);
    });

    it('project admin can create rules', async () => {
      const result = await runChain(chain, { systemRole: 'user', projectRole: 'admin' });
      expect(result.allowed).toBe(true);
    });

    it('API key can create rules (bypasses role check)', async () => {
      const result = await runChain(chain, { hasApiKey: true });
      expect(result.allowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Permissions endpoint — requireUser
  // --------------------------------------------------------------------------
  describe('GET /api/v1/me/permissions', () => {
    const chain = [requireUser];

    it('any JWT user can access', async () => {
      expect((await runChain(chain, { systemRole: 'viewer' })).allowed).toBe(true);
      expect((await runChain(chain, { systemRole: 'user' })).allowed).toBe(true);
      expect((await runChain(chain, { systemRole: 'admin' })).allowed).toBe(true);
    });

    it('API key cannot access', async () => {
      expect((await runChain(chain, { hasApiKey: true })).allowed).toBe(false);
    });

    it('unauthenticated cannot access', async () => {
      expect((await runChain(chain, {})).allowed).toBe(false);
    });
  });
});

// ============================================================================
// requirePermission — system-level permission table check
// ============================================================================

describe('requirePermission regression', () => {
  function createMockDb(hasPermission: boolean) {
    return {
      query: vi.fn().mockResolvedValue({
        rows: hasPermission ? [{ '?column?': 1 }] : [],
      }),
    } as any;
  }

  it('should allow system admin without querying permissions table', async () => {
    const db = createMockDb(false); // no permission row, but admin bypasses
    const middleware = requirePermission(db, 'integration_rules', 'create');
    const result = await runMiddleware(middleware, { systemRole: 'admin' });
    expect(result.allowed).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('should allow user with matching permission', async () => {
    const db = createMockDb(true);
    const middleware = requirePermission(db, 'integration_rules', 'create');
    const result = await runMiddleware(middleware, { systemRole: 'user' });
    expect(result.allowed).toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SELECT 1 FROM permissions'), [
      'user',
      'integration_rules',
      'create',
    ]);
  });

  it('should deny user without matching permission', async () => {
    const db = createMockDb(false);
    const middleware = requirePermission(db, 'integration_rules', 'delete');
    const result = await runMiddleware(middleware, { systemRole: 'viewer' });
    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it('should bypass for API key auth (no authUser)', async () => {
    const db = createMockDb(false);
    const middleware = requirePermission(db, 'integration_rules', 'create');
    const result = await runMiddleware(middleware, { hasApiKey: true });
    expect(result.allowed).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('should bypass for project-scoped API key auth', async () => {
    const db = createMockDb(false);
    const middleware = requirePermission(db, 'integration_rules', 'create');
    const result = await runMiddleware(middleware, { hasProjectScopedApiKey: true });
    expect(result.allowed).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('should return 401 for unauthenticated requests', async () => {
    const db = createMockDb(false);
    const middleware = requirePermission(db, 'integration_rules', 'create');
    const result = await runMiddleware(middleware, {});
    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  // Verify viewer can read but not create/update/delete integration_rules
  // (matches the seeded permissions table)
  it('should model integration_rules permission matrix correctly', async () => {
    const actions = ['create', 'read', 'update', 'delete'] as const;
    const viewerAllowed: Record<string, boolean> = {
      create: false,
      read: true,
      update: false,
      delete: false,
    };

    for (const action of actions) {
      const db = createMockDb(viewerAllowed[action]);
      const middleware = requirePermission(db, 'integration_rules', action);
      const result = await runMiddleware(middleware, { systemRole: 'viewer' });
      expect(result.allowed).toBe(viewerAllowed[action]);
    }
  });
});

// ============================================================================
// requireApiKeyPermission — API-key permission gate (regression: ingest-only
// SDK keys must not bypass read permission via authProject shortcut)
// ============================================================================

describe('requireApiKeyPermission regression', () => {
  // The signup-issued ingest-only key has permission_scope='custom' and
  // permissions=['reports:write','sessions:write'] (see saas/services/
  // signup.service.ts). It also has allowed_projects.length === 1, which
  // means handlers.ts also sets request.authProject. The middleware MUST
  // gate on request.apiKey.permissions, not fall through to authProject.

  function createApiKeyRequest(opts: {
    permissions?: string[];
    permission_scope?: 'full' | 'read' | 'write' | 'custom';
    hasAuthProject?: boolean;
  }): FastifyRequest {
    return {
      authUser: undefined,
      apiKey: {
        id: 'key-1',
        allowed_projects: ['project-1'],
        permissions: opts.permissions ?? [],
        permission_scope: opts.permission_scope ?? 'custom',
      },
      authProject: opts.hasAuthProject ? { id: 'project-1' } : undefined,
    } as unknown as FastifyRequest;
  }

  it('JWT user bypasses (permissions checked elsewhere)', async () => {
    const middleware = requireApiKeyPermission('reports:read');
    const request = {
      authUser: { id: 'u1', email: 'u@test.com', role: 'user' },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any).code.mock.calls.length).toBe(0);
  });

  it('ingest-only key (reports:write only) is denied reports:read', async () => {
    const middleware = requireApiKeyPermission('reports:read');
    const request = createApiKeyRequest({
      permissions: ['reports:write', 'sessions:write'],
      hasAuthProject: true, // single allowed_projects → authProject is set
    });
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any)._statusCode).toBe(403);
  });

  it('ingest-only key (reports:write only) is denied sessions:read', async () => {
    const middleware = requireApiKeyPermission('sessions:read');
    const request = createApiKeyRequest({
      permissions: ['reports:write', 'sessions:write'],
      hasAuthProject: true,
    });
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any)._statusCode).toBe(403);
  });

  it('ingest-only key passes its OWN permission (reports:write)', async () => {
    const middleware = requireApiKeyPermission('reports:write');
    const request = createApiKeyRequest({
      permissions: ['reports:write', 'sessions:write'],
      hasAuthProject: true,
    });
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any).code.mock.calls.length).toBe(0);
  });

  it('full-scope key (permissions: ["*"]) passes any permission', async () => {
    const middleware = requireApiKeyPermission('reports:read');
    const request = createApiKeyRequest({
      permissions: ['*'],
      permission_scope: 'full',
    });
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any).code.mock.calls.length).toBe(0);
  });

  it('read-scope key passes reports:read', async () => {
    const middleware = requireApiKeyPermission('reports:read');
    const request = createApiKeyRequest({
      permissions: ['reports:read', 'sessions:read'],
      permission_scope: 'read',
    });
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any).code.mock.calls.length).toBe(0);
  });

  it('unauthenticated request returns 401', async () => {
    const middleware = requireApiKeyPermission('reports:read');
    const request = {} as FastifyRequest;
    const reply = createReply();
    await middleware(request, reply);
    expect((reply as any)._statusCode).toBe(401);
  });
});

// ============================================================================
// CROSS-CUTTING CONCERNS
// ============================================================================

describe('Cross-cutting security properties', () => {
  it('system admin always bypasses requireProjectRole regardless of required level', async () => {
    const levels: ProjectRole[] = ['owner', 'admin', 'member', 'viewer'];
    for (const level of levels) {
      const result = await runMiddleware(requireProjectRole(level), { systemRole: 'admin' });
      expect(result.allowed).toBe(true);
    }
  });

  it('API key auth always bypasses requireProjectRole regardless of required level', async () => {
    const levels: ProjectRole[] = ['owner', 'admin', 'member', 'viewer'];
    for (const level of levels) {
      const result = await runMiddleware(requireProjectRole(level), { hasApiKey: true });
      expect(result.allowed).toBe(true);
    }
  });

  it('JWT takes precedence over API key when both present', async () => {
    // User has JWT (viewer system role, viewer project role) + API key
    // requireProjectRole('admin') should DENY because JWT takes precedence
    const result = await runMiddleware(requireProjectRole('admin'), {
      systemRole: 'user',
      projectRole: 'viewer',
      hasApiKey: true,
    });
    expect(result.allowed).toBe(false);
  });

  it('role hierarchy is strictly ordered: owner > admin > member > viewer', async () => {
    // viewer cannot access admin-level
    expect(
      (
        await runMiddleware(requireProjectRole('admin'), {
          systemRole: 'user',
          projectRole: 'viewer',
        })
      ).allowed
    ).toBe(false);

    // member cannot access admin-level
    expect(
      (
        await runMiddleware(requireProjectRole('admin'), {
          systemRole: 'user',
          projectRole: 'member',
        })
      ).allowed
    ).toBe(false);

    // admin can access admin-level
    expect(
      (
        await runMiddleware(requireProjectRole('admin'), {
          systemRole: 'user',
          projectRole: 'admin',
        })
      ).allowed
    ).toBe(true);

    // admin cannot access owner-level
    expect(
      (
        await runMiddleware(requireProjectRole('owner'), {
          systemRole: 'user',
          projectRole: 'admin',
        })
      ).allowed
    ).toBe(false);

    // owner can access everything
    const levels: ProjectRole[] = ['owner', 'admin', 'member', 'viewer'];
    for (const level of levels) {
      expect(
        (
          await runMiddleware(requireProjectRole(level), {
            systemRole: 'user',
            projectRole: 'owner',
          })
        ).allowed
      ).toBe(true);
    }
  });
});
