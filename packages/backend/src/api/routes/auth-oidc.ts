import type { FastifyInstance } from 'fastify';
import type { IServiceContainer } from '../../container/index.js';
import { discoverIssuerValidated, storeOidcState, generators } from '../services/oidc-service.js';
import { AppError, ConfigurationError } from '../middleware/error.js';
import { config } from '../../config.js';

// fastify.container is not globally typed anywhere in this codebase (server.ts
// itself only reads it back via this same cast) — this local helper is #368's
// shared access point too, not a one-off.
function getContainer(fastify: FastifyInstance): IServiceContainer {
  return (fastify as FastifyInstance & { container: IServiceContainer }).container;
}

export function oidcRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { tenantId: string } }>(
    '/api/v1/auth/oidc/:tenantId/login',
    { config: { public: true } },
    async (request, reply) => {
      const { tenantId } = request.params;
      const idpConfig = await getContainer(fastify).db.oidcIdpConfigs.findByTenantId(tenantId);
      if (!idpConfig) {
        throw new AppError('SSO not configured', 404, 'NotFound');
      }

      // Never derive the redirect_uri from request.protocol/hostname — both
      // are attacker-influenceable via the Host / X-Forwarded-* headers
      // depending on proxy config, and a spoofed redirect_uri is
      // security-relevant for an OIDC flow. Use the fixed, operator-set
      // base URL instead.
      if (!config.oidc.redirectBaseUrl) {
        throw new ConfigurationError(
          'OIDC_REDIRECT_BASE_URL must be configured to serve OIDC login for a tenant with SSO enabled',
          'oidc-routes'
        );
      }

      const redirectUri = `${config.oidc.redirectBaseUrl}/api/v1/auth/oidc/${tenantId}/callback`;
      const issuer = await discoverIssuerValidated(idpConfig.issuerUrl);

      // openid-client@5.7.1: class-based construction, not the v6 functional API.
      const client = new issuer.Client({ client_id: idpConfig.clientId, response_types: ['code'] });
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);

      const authUrl = client.authorizationUrl({
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
      });

      await storeOidcState(state, {
        nonce,
        codeVerifier,
        redirectUri,
        tenantId,
        issuer: issuer.metadata.issuer,
      });

      return reply.redirect(authUrl);
    }
  );

  // #368 appends the callback handler here, inside this same oidcRoutes() function.
}
