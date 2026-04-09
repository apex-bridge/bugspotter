/**
 * Tenant Middleware Tests
 * Tests for subdomain extraction and org resolution
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  extractSubdomain,
  RESERVED_SUBDOMAINS,
  TENANT_EXEMPT_PREFIXES,
} from '../../src/saas/middleware/tenant.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';

describe('extractSubdomain', () => {
  it('should extract subdomain from 3-part hostname', () => {
    expect(extractSubdomain('acme.bugspotter.io')).toBe('acme');
  });

  it('should extract subdomain from hostname with port', () => {
    expect(extractSubdomain('acme.bugspotter.io:3000')).toBe('acme');
  });

  it('should return null for 2-part hostname (no subdomain)', () => {
    expect(extractSubdomain('bugspotter.io')).toBeNull();
  });

  it('should return null for localhost', () => {
    expect(extractSubdomain('localhost')).toBeNull();
  });

  it('should return null for localhost with port', () => {
    expect(extractSubdomain('localhost:3000')).toBeNull();
  });

  it('should extract subdomain from 4-part hostname', () => {
    expect(extractSubdomain('acme.app.bugspotter.io')).toBe('acme');
  });

  it('should return null for IP addresses', () => {
    expect(extractSubdomain('192.168.1.1')).toBeNull();
  });

  it('should return null for IP addresses with port', () => {
    expect(extractSubdomain('192.168.1.1:8080')).toBeNull();
  });

  describe('Reserved subdomains', () => {
    Array.from(RESERVED_SUBDOMAINS).forEach((subdomain) => {
      it(`should return null for reserved subdomain: ${subdomain}`, () => {
        expect(extractSubdomain(`${subdomain}.bugspotter.io`)).toBeNull();
      });
    });

    it('should reject reserved subdomains regardless of case', () => {
      expect(extractSubdomain('Admin.bugspotter.io')).toBeNull();
      expect(extractSubdomain('WWW.bugspotter.io')).toBeNull();
      expect(extractSubdomain('API.bugspotter.io')).toBeNull();
      expect(extractSubdomain('LoGiN.bugspotter.io')).toBeNull();
    });
  });

  describe('Minimum subdomain length', () => {
    it('should return null for 1-character subdomain', () => {
      expect(extractSubdomain('a.bugspotter.io')).toBeNull();
    });

    it('should return null for 2-character subdomain', () => {
      expect(extractSubdomain('ab.bugspotter.io')).toBeNull();
    });

    it('should accept 3-character subdomain', () => {
      expect(extractSubdomain('abc.bugspotter.io')).toBe('abc');
    });

    it('should accept longer subdomains', () => {
      expect(extractSubdomain('mycompany.bugspotter.io')).toBe('mycompany');
    });

    it('should reject 2-letter regional codes', () => {
      expect(extractSubdomain('kz.bugspotter.io')).toBeNull();
      expect(extractSubdomain('eu.bugspotter.io')).toBeNull();
      expect(extractSubdomain('us.bugspotter.io')).toBeNull();
      expect(extractSubdomain('rf.bugspotter.io')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle subdomains with hyphens', () => {
      expect(extractSubdomain('my-company.bugspotter.io')).toBe('my-company');
    });

    it('should handle subdomains with numbers', () => {
      expect(extractSubdomain('company123.bugspotter.io')).toBe('company123');
    });

    it('should normalize subdomain case to lowercase', () => {
      expect(extractSubdomain('AcMe.bugspotter.io')).toBe('acme');
      expect(extractSubdomain('MyCompany.bugspotter.io')).toBe('mycompany');
      expect(extractSubdomain('UPPERCASE.bugspotter.io')).toBe('uppercase');
    });

    it('should extract first part only from multi-level subdomains', () => {
      expect(extractSubdomain('team.acme.bugspotter.io')).toBe('team');
    });

    it('should handle empty string', () => {
      expect(extractSubdomain('')).toBeNull();
    });

    it('should handle single dot', () => {
      expect(extractSubdomain('.')).toBeNull();
    });

    it('should handle hostname with trailing dot', () => {
      expect(extractSubdomain('acme.bugspotter.io.')).toBe('acme');
    });

    it('should return null for 2-part hostname with trailing dot', () => {
      expect(extractSubdomain('bugspotter.io.')).toBeNull();
    });
  });
});

describe('tenantMiddleware integration', () => {
  const originalEnv = process.env.DEPLOYMENT_MODE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalEnv;
    }
    resetDeploymentConfig();
  });

  it('should skip in selfhosted mode', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware({} as never);

    const request = { hostname: 'acme.bugspotter.io', routeOptions: {} } as never;
    const reply = { code: () => ({ send: () => {} }) } as never;

    // Should not throw, just return
    await middleware(request, reply);
  });

  it('should skip public routes in SaaS mode', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware({} as never);

    const request = {
      hostname: 'acme.bugspotter.io',
      routeOptions: { config: { public: true } },
    } as never;
    const reply = { code: () => ({ send: () => {} }) } as never;

    // Should not throw, just return
    await middleware(request, reply);
  });

  it.each([
    ['bugspotter.io', 'bare domain (no subdomain)'],
    ['admin.bugspotter.io', 'reserved subdomain'],
    ['ab.bugspotter.io', 'too short subdomain'],
  ])('should pass through without org context for %s (%s)', async (hostname) => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware({} as never);

    const request = {
      hostname,
      routeOptions: { url: '/api/test' },
    } as FastifyRequest;
    let sentCode = 0;

    const reply = {
      code: (code: number) => ({
        send: () => {
          sentCode = code;
        },
      }),
    } as never;

    await middleware(request, reply);

    expect(sentCode).toBe(0);
    expect(request.organizationId).toBeUndefined();
  });

  it('should skip unmatched routes (404 handler)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizations: {
        findBySubdomain: async () => {
          throw new Error('Should not call DB for unmatched routes');
        },
      },
    };

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware(mockDb as never);

    // routeOptions.url is undefined for unmatched routes
    const request = {
      hostname: 'acme.bugspotter.io',
      routeOptions: {},
    } as never;
    const reply = { code: () => ({ send: () => {} }) } as never;

    // Should return early without calling DB
    await middleware(request, reply);
  });

  it('should return 404 if organization not found', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizations: {
        findBySubdomain: async () => null,
      },
    };

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware(mockDb as never);

    const request = {
      id: 'test-request-id',
      hostname: 'nonexistent.bugspotter.io',
      routeOptions: { url: '/api/test' },
    } as never;
    let sentCode = 0;
    let sentData: unknown;

    const reply = {
      code: (code: number) => ({
        send: (data: unknown) => {
          sentCode = code;
          sentData = data;
        },
      }),
    } as never;

    await middleware(request, reply);

    expect(sentCode).toBe(404);
    expect(sentData).toMatchObject({
      success: false,
      error: 'OrganizationNotFound',
      message: 'No organization found for subdomain: nonexistent',
      statusCode: 404,
      requestId: 'test-request-id',
    });
    expect((sentData as { timestamp: string }).timestamp).toBeDefined();
  });

  it('should return 403 for inactive subscriptions (canceled)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockOrg = {
      id: 'org-123',
      subdomain: 'acme',
      subscription_status: 'canceled',
    };

    const mockDb = {
      organizations: {
        findBySubdomain: async () => mockOrg,
      },
    };

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware(mockDb as never);

    const request = {
      id: 'test-request-id',
      hostname: 'acme.bugspotter.io',
      routeOptions: { url: '/api/test' },
    } as never;
    let sentCode = 0;
    let sentData: unknown;

    const reply = {
      code: (code: number) => ({
        send: (data: unknown) => {
          sentCode = code;
          sentData = data;
        },
      }),
    } as never;

    await middleware(request, reply);

    expect(sentCode).toBe(403);
    expect(sentData).toMatchObject({
      success: false,
      error: 'SubscriptionInactive',
      message: 'Your subscription is not active',
      statusCode: 403,
      requestId: 'test-request-id',
      details: { status: 'canceled' },
    });
    expect((sentData as { timestamp: string }).timestamp).toBeDefined();
  });

  it('should return 403 for inactive subscriptions (trial_expired)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockOrg = {
      id: 'org-456',
      subdomain: 'expired',
      subscription_status: 'trial_expired',
    };

    const mockDb = {
      organizations: {
        findBySubdomain: async () => mockOrg,
      },
    };

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware(mockDb as never);

    const request = {
      id: 'test-request-id',
      hostname: 'expired.bugspotter.io',
      routeOptions: { url: '/api/test' },
    } as never;
    let sentCode = 0;
    let sentData: unknown;

    const reply = {
      code: (code: number) => ({
        send: (data: unknown) => {
          sentCode = code;
          sentData = data;
        },
      }),
    } as never;

    await middleware(request, reply);

    expect(sentCode).toBe(403);
    expect(sentData).toMatchObject({
      success: false,
      error: 'SubscriptionInactive',
      message: 'Your subscription is not active',
      statusCode: 403,
      requestId: 'test-request-id',
      details: { status: 'trial_expired' },
    });
    expect((sentData as { timestamp: string }).timestamp).toBeDefined();
  });

  it('should attach organization to request for active subscription', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockOrg = {
      id: 'org-789',
      subdomain: 'active',
      subscription_status: 'active',
      name: 'Active Corp',
    };

    const mockDb = {
      organizations: {
        findBySubdomain: async () => mockOrg,
      },
    };

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware(mockDb as never);

    const request = {
      hostname: 'active.bugspotter.io',
      routeOptions: { url: '/api/test' },
    } as FastifyRequest;
    const reply = { code: () => ({ send: () => {} }) } as never;

    await middleware(request, reply);

    expect(request.organization).toEqual(mockOrg);
    expect(request.organizationId).toBe('org-789');
  });

  it('should allow trial status', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockOrg = {
      id: 'org-trial',
      subdomain: 'trial',
      subscription_status: 'trial',
      name: 'Trial Corp',
    };

    const mockDb = {
      organizations: {
        findBySubdomain: async () => mockOrg,
      },
    };

    const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
    const middleware = createTenantMiddleware(mockDb as never);

    const request = {
      hostname: 'trial.bugspotter.io',
      routeOptions: { url: '/api/test' },
    } as FastifyRequest;
    const reply = { code: () => ({ send: () => {} }) } as never;

    await middleware(request, reply);

    expect(request.organization).toEqual(mockOrg);
    expect(request.organizationId).toBe('org-trial');
  });

  describe('tenant-exempt routes', () => {
    const mockDb = {
      organizations: {
        findBySubdomain: async () => {
          throw new Error('Should not call DB for tenant-exempt routes');
        },
      },
    };

    // Helper: create middleware + request for a given route URL on the hub domain
    async function callMiddleware(routeUrl: string) {
      const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
      const middleware = createTenantMiddleware(mockDb as never);

      let sentCode = 0;
      const request = {
        id: 'test-exempt',
        hostname: 'app.bugspotter.io', // hub domain — no valid subdomain
        routeOptions: { url: routeUrl },
      } as never;
      const reply = {
        code: (code: number) => ({
          send: () => {
            sentCode = code;
          },
        }),
      } as never;

      await middleware(request, reply);
      return sentCode;
    }

    it('should export TENANT_EXEMPT_PREFIXES as a non-empty array', () => {
      expect(TENANT_EXEMPT_PREFIXES).toBeDefined();
      expect(TENANT_EXEMPT_PREFIXES.length).toBeGreaterThan(0);
    });

    it.each([
      ['/api/v1/admin/health', 'admin health'],
      ['/api/v1/admin/settings', 'admin settings'],
      ['/api/v1/admin/cache/stats', 'admin cache stats'],
      ['/api/v1/admin/users', 'admin users list'],
      ['/api/v1/admin/organizations', 'admin organizations'],
      ['/api/v1/admin/jobs/failed', 'admin failed jobs'],
      ['/api/v1/users/me/preferences', 'user preferences'],
      ['/api/v1/audit-logs', 'audit logs list'],
      ['/api/v1/audit-logs/statistics', 'audit log statistics'],
      ['/api/v1/audit-logs/user/:userId', 'user audit logs'],
    ])('should skip tenant resolution for %s (%s)', async (routeUrl) => {
      process.env.DEPLOYMENT_MODE = 'saas';
      resetDeploymentConfig();

      const code = await callMiddleware(routeUrl);
      // sentCode stays 0 = no error response sent = middleware returned early
      expect(code).toBe(0);
    });

    it.each([
      ['/api/v1/projects', 'projects'],
      ['/api/v1/bug-reports', 'bug reports'],
      ['/api/v1/organizations', 'organizations'],
      ['/api/v1/users/search', 'user search (not /me/)'],
    ])(
      'should pass through hub-domain request for non-exempt %s (%s) without org context',
      async (routeUrl) => {
        process.env.DEPLOYMENT_MODE = 'saas';
        resetDeploymentConfig();

        const code = await callMiddleware(routeUrl);
        // Hub domain passes through — routes handle absence of organizationId themselves
        expect(code).toBe(0);
      }
    );
  });

  describe('hub-domain passthrough (no subdomain)', () => {
    it('should pass through without org context on hub domain for any route', async () => {
      process.env.DEPLOYMENT_MODE = 'saas';
      resetDeploymentConfig();

      const mockDb = {
        organizations: {
          findBySubdomain: async () => {
            throw new Error('Should not call DB on hub domain');
          },
        },
      };

      const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
      const middleware = createTenantMiddleware(mockDb as never);

      const request = {
        hostname: 'app.bugspotter.io', // hub domain — reserved subdomain → null
        routeOptions: { url: '/api/v1/organizations' },
      } as FastifyRequest;
      let sentCode = 0;

      const reply = {
        code: (code: number) => ({
          send: () => {
            sentCode = code;
          },
        }),
      } as never;

      await middleware(request, reply);

      // Should NOT send any error — just return without org context
      expect(sentCode).toBe(0);
      expect(request.organizationId).toBeUndefined();
    });

    it.each([
      ['/api/v1/projects', 'projects'],
      ['/api/v1/bug-reports', 'bug reports'],
      ['/api/v1/organizations', 'organizations'],
      ['/api/v1/notifications', 'notifications'],
      ['/api/v1/analytics/dashboard', 'analytics dashboard'],
    ])('should pass through hub-domain request for %s (%s)', async (routeUrl) => {
      process.env.DEPLOYMENT_MODE = 'saas';
      resetDeploymentConfig();

      const mockDb = {
        organizations: {
          findBySubdomain: async () => {
            throw new Error('Should not call DB on hub domain');
          },
        },
      };

      const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
      const middleware = createTenantMiddleware(mockDb as never);

      let sentCode = 0;
      const request = {
        hostname: 'app.bugspotter.io',
        routeOptions: { url: routeUrl },
      } as FastifyRequest;
      const reply = {
        code: (code: number) => ({
          send: () => {
            sentCode = code;
          },
        }),
      } as never;

      await middleware(request, reply);
      expect(sentCode).toBe(0);
      expect(request.organizationId).toBeUndefined();
    });

    it('should pass through hub-domain request for bare domain (bugspotter.io)', async () => {
      process.env.DEPLOYMENT_MODE = 'saas';
      resetDeploymentConfig();

      const { createTenantMiddleware } = await import('../../src/saas/middleware/tenant.js');
      const middleware = createTenantMiddleware({} as never);

      const request = {
        hostname: 'bugspotter.io',
        routeOptions: { url: '/api/v1/organizations' },
      } as FastifyRequest;
      let sentCode = 0;

      const reply = {
        code: (code: number) => ({
          send: () => {
            sentCode = code;
          },
        }),
      } as never;

      await middleware(request, reply);
      expect(sentCode).toBe(0);
      expect(request.organizationId).toBeUndefined();
    });
  });
});
