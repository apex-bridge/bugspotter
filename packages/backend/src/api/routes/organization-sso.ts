/**
 * Organization SSO (OIDC) Config Routes
 *
 *   GET /api/v1/organizations/:id/sso  - read the tenant's IdP config (org admin)
 *   PUT /api/v1/organizations/:id/sso  - create or replace it (org admin)
 *
 * The missing half of ADR-0044: #352 built the table, repository and at-rest
 * encryption, and #367/#368 built the login and callback that consume it, but
 * nothing ever exposed the config itself over HTTP. The admin UI (#407/#409)
 * shipped against an assumed path, so the SSO page has been unable to read or
 * save since it landed and the only way to configure a tenant was a direct
 * database write (#438).
 *
 * The client secret never leaves the backend. Reads report only
 * `hasClientSecret`; writes may omit it to keep the stored one.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';

import { guard } from '../authorization/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../middleware/error.js';
import { successResponseSchema } from '../schemas/common-schema.js';
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';
import { config as globalConfig } from '../../config.js';
import type { OidcIdpConfig } from '../../db/repositories/oidc-idp-config.repository.js';

const orgIdParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const updateSsoBody = {
  type: 'object',
  required: ['issuerUrl', 'clientId', 'allowedDomains', 'enforceSso'],
  // No additional properties: the request body is written to `audit_logs`
  // (details.body) by the global audit hook, so unknown fields would be
  // persisted verbatim. Keep the shape closed.
  additionalProperties: false,
  properties: {
    issuerUrl: { type: 'string', minLength: 1, maxLength: 2048 },
    clientId: { type: 'string', minLength: 1, maxLength: 512 },
    // Optional, never nullable. Omitted means "keep the stored secret";
    // an empty string is rejected rather than silently clearing it.
    clientSecret: { type: 'string', minLength: 1, maxLength: 1024 },
    allowedDomains: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 253 },
      // At least one, because ADR-0044 decision 2 makes this fail closed: the
      // callback rejects every login when the list is empty, deliberately,
      // rather than permitting any domain by default. Persisting an empty list
      // would therefore store a configuration that can never authenticate
      // anyone - and with enforceSso on, that is an org-wide lockout of exactly
      // the shape #408 already shipped once.
      minItems: 1,
      maxItems: 100,
    },
    enforceSso: { type: 'boolean' },
  },
} as const;

const ssoResponse = {
  200: successResponseSchema,
} as const;

/**
 * The callback the tenant must register with their IdP. Computed exactly as
 * `auth-oidc.ts` computes it at login time, so what the admin UI shows and what
 * the server actually sends as `redirect_uri` cannot drift.
 *
 * Null when `OIDC_REDIRECT_BASE_URL` is unset - the UI says so rather than
 * printing a URI that would not match. The login route throws a
 * ConfigurationError in that state, so this doubles as the only visible
 * warning a tenant admin gets before hitting it.
 */
function resolveRedirectUri(tenantId: string): string | null {
  const base = globalConfig.oidc.redirectBaseUrl;
  return base ? `${base}/api/v1/auth/oidc/${tenantId}/callback` : null;
}

/**
 * Trim, lowercase and de-duplicate the domain list before it is stored.
 *
 * The callback compares `domain.toLowerCase() === emailDomain` with no trim, so
 * a stored `"example.com "` matches nothing and rejects every login - saved
 * happily, broken silently, and indistinguishable from a misconfigured IdP.
 * Lowercasing here too means what is stored is what is compared, rather than
 * relying on the callback to keep normalizing.
 *
 * The admin UI already trims, but the API is the contract: a direct caller, or
 * any future client, gets the same guarantee.
 */
function normalizeAllowedDomains(domains: string[]): string[] {
  const normalized = domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  return [...new Set(normalized)];
}

/** Read shape. Never includes the secret itself - only whether one is stored. */
function toResponse(tenantId: string, stored: OidcIdpConfig | null) {
  return {
    issuerUrl: stored?.issuerUrl ?? '',
    clientId: stored?.clientId ?? '',
    hasClientSecret: Boolean(stored?.clientSecret),
    allowedDomains: stored?.allowedDomains ?? [],
    enforceSso: stored?.enforceSso ?? false,
    redirectUri: resolveRedirectUri(tenantId),
  };
}

export function organizationSsoRoutes(fastify: FastifyInstance, db: DatabaseClient): void {
  const adminPreHandler = [
    guard(db, {
      auth: 'user',
      resource: { type: 'organization' },
      orgRole: 'admin',
      action: 'manage',
    }),
  ];

  // GET /api/v1/organizations/:id/sso
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/sso',
    { preHandler: adminPreHandler, schema: { params: orgIdParams, response: ssoResponse } },
    async (request, reply) => {
      const { id } = request.params;
      const stored = await db.oidcIdpConfigs.findByTenantId(id);
      // An unconfigured tenant is not an error - the admin UI needs an empty
      // form to fill in, not a 404 it would have to special-case.
      return sendSuccess(reply, toResponse(id, stored));
    }
  );

  // PUT /api/v1/organizations/:id/sso
  fastify.put<{
    Params: { id: string };
    Body: {
      issuerUrl: string;
      clientId: string;
      clientSecret?: string;
      allowedDomains: string[];
      enforceSso: boolean;
    };
  }>(
    '/api/v1/organizations/:id/sso',
    {
      preHandler: adminPreHandler,
      schema: { params: orgIdParams, body: updateSsoBody, response: ssoResponse },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { issuerUrl, clientId, clientSecret, allowedDomains, enforceSso } = request.body;

      // The issuer is fetched server-side at every login (Issuer.discover), so
      // a tenant admin - a lower-trust actor than an operator - controls an
      // outbound request target. Reject the obvious cases at save time rather
      // than leaving them as a login-time failure nobody can trace back to this
      // form.
      //
      // This is the string-level check only: it blocks literal private and
      // link-local addresses, alternative IPv4 encodings and non-http(s)
      // schemes. It does NOT resolve DNS, so a public hostname pointing at a
      // private address still passes here. That is deliberate - the real
      // control is at login, where `pinHostnameToIp` resolves once and
      // `assertResolvedIpAllowed` checks the actual IP the request will reach.
      // Resolving here as well would only be advisory (DNS can change between
      // save and login) while adding latency and a transient-failure mode to
      // saving a form.
      let parsedIssuer: URL;
      try {
        parsedIssuer = validateSSRFProtection(issuerUrl);
      } catch (error) {
        throw new AppError(
          `Invalid issuer URL: ${error instanceof Error ? error.message : 'rejected'}`,
          400,
          'ValidationError'
        );
      }
      if (parsedIssuer.protocol !== 'https:') {
        throw new AppError('Issuer URL must use https', 400, 'ValidationError');
      }

      // `minItems: 1` on the schema rejects a literally empty list, but not one
      // that becomes empty here (e.g. [" "]). Both end up storing a config that
      // rejects every login, so both are refused.
      const normalizedDomains = normalizeAllowedDomains(allowedDomains);
      if (normalizedDomains.length === 0) {
        throw new AppError(
          'allowedDomains must contain at least one non-blank domain',
          400,
          'ValidationError'
        );
      }

      // Only read the stored config when the secret was omitted and we need to
      // carry it forward - on the common "update including the secret" path
      // this query would be pure overhead.
      const effectiveSecret =
        clientSecret ?? (await db.oidcIdpConfigs.findByTenantId(id))?.clientSecret;
      if (!effectiveSecret) {
        // Omitted secret means "keep the stored one" - the admin UI omits the
        // key rather than sending '' precisely so that path is reachable. There
        // is nothing to keep on first configuration, so require it then.
        throw new AppError(
          'clientSecret is required when configuring SSO for the first time',
          400,
          'ValidationError'
        );
      }

      const saved = await db.oidcIdpConfigs.upsert({
        tenantId: id,
        issuerUrl,
        clientId,
        clientSecret: effectiveSecret,
        allowedDomains: normalizedDomains,
        enforceSso,
      });

      return sendSuccess(reply, toResponse(id, saved));
    }
  );
}
