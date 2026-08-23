import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IServiceContainer } from '../../container/index.js';
import {
  discoverIssuerValidated,
  storeOidcState,
  consumeOidcState,
  generators,
} from '../services/oidc-service.js';
import { AppError, ConfigurationError } from '../middleware/error.js';
import { config } from '../../config.js';
import { generateAuthTokens } from '../utils/auth-tokens.js';
import { buildRefreshCookieOptions } from '../utils/auth-cookies.js';
import { sendSuccess } from '../utils/response.js';
import { omitFields } from '../utils/resource.js';
import type { User } from '../../db/types.js';

// fastify.container is not globally typed anywhere in this codebase (server.ts
// itself only reads it back via this same cast) — this local helper is #368's
// shared access point too, not a one-off.
function getContainer(fastify: FastifyInstance): IServiceContainer {
  return (fastify as FastifyInstance & { container: IServiceContainer }).container;
}

// Every OIDC-flow rejection returns this exact generic message - deliberately, not just for
// brevity. A cross-tenant email match, an expired token, and a tampered signature must all be
// indistinguishable to the caller (ADR-0044); one shared helper makes that a structural
// guarantee instead of a convention repeated at every call site.
function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: 'Authentication failed' });
}

export function oidcRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { tenantId: string } }>(
    '/api/v1/auth/oidc/:tenantId/login',
    { config: { public: true } },
    handleOidcLogin
  );

  // #368 appends the callback handler here, inside this same oidcRoutes() function.
  fastify.get<{
    Params: { tenantId: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>(
    '/api/v1/auth/oidc/:tenantId/callback',
    // The IdP redirects the browser here unauthenticated - same reason the login route
    // above carries this flag; without it the auth middleware rejects the request before
    // the handler ever runs (packages/backend/src/api/middleware/auth/middleware.ts).
    { config: { public: true } },
    handleOidcCallback
  );

  async function handleOidcLogin(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply
  ) {
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

  async function handleOidcCallback(
    request: FastifyRequest<{
      Params: { tenantId: string };
      Querystring: { code?: string; state?: string; error?: string };
    }>,
    reply: FastifyReply
  ) {
    const { tenantId } = request.params;
    const { code, state: stateParam, error: idpError } = request.query;
    const db = getContainer(fastify).db;

    if (idpError || !code || !stateParam) {
      return unauthorized(reply);
    }

    // Atomic consume: a replayed state value must fail on the second
    // request, not merely be "checked" and left in place.
    const statePayload = await consumeOidcState(stateParam);
    if (!statePayload) {
      return unauthorized(reply);
    }
    if (statePayload.tenantId !== tenantId) {
      return unauthorized(reply);
    }

    const idpConfig = await db.oidcIdpConfigs.findByTenantId(tenantId);
    if (!idpConfig) {
      return unauthorized(reply);
    }

    // discoverIssuerValidated() and client.callback() both throw on failure — SSRF
    // rejection, discovery failure, or openid-client's own iss/aud/nonce/exp/signature
    // validation inside callback() — and every such rejection must map to the same
    // generic 401 (AC / test cases B-E, L-M), not an unhandled 500.
    let claims: { email?: string; email_verified?: boolean; name?: unknown };
    try {
      const issuer = await discoverIssuerValidated(idpConfig.issuerUrl);
      // Bind the callback to the same IdP the login step discovered (ADR-0044: the CSRF
      // state is bound to the issuer, not just checked for existence). Without this, a
      // tenant's IdP config could change between login and callback and the stored state
      // would still be honored against a different issuer than the one the user actually
      // authenticated with.
      if (issuer.metadata.issuer !== statePayload.issuer) {
        return unauthorized(reply);
      }
      // openid-client@5.7.1: class-based construction, matching the login handler above.
      const client = new issuer.Client({
        client_id: idpConfig.clientId,
        client_secret: idpConfig.clientSecret,
        response_types: ['code'],
      });

      // openid-client validates iss/aud/nonce/exp/JWKS signature internally on callback().
      // `state` must be echoed in `params` too, not just `checks` — openid-client@5.7.1's
      // callback() throws "state missing from the response" when checks.state is set but
      // params.state isn't (lib/client.js), which would 401 every real callback while
      // leaving the fully-mocked unit tests green.
      const tokenSet = await client.callback(
        statePayload.redirectUri,
        { code, state: stateParam },
        { state: stateParam, nonce: statePayload.nonce, code_verifier: statePayload.codeVerifier }
      );
      claims = tokenSet.claims();
    } catch {
      return unauthorized(reply);
    }

    if (claims.email_verified !== true) {
      return unauthorized(reply);
    }
    // The ID token's claim shape is IdP-controlled, not just signature-verified — a
    // truthy non-string `email` (e.g. a number or object) would pass `!claims.email`
    // and then throw on .split() below, outside this try/catch, turning a bad claim
    // into an unhandled 500 instead of the generic 401 every other rejection returns.
    if (typeof claims.email !== 'string' || claims.email.length === 0) {
      return unauthorized(reply);
    }
    const email = claims.email;

    if (!idpConfig.allowedDomains?.length) {
      return unauthorized(reply);
    }
    // .toLowerCase() so the check isn't case-sensitive; split('@')[1] is still undefined
    // for a malformed email with no '@', so the fail-closed check covers that too. The
    // configured domains themselves aren't guaranteed lowercase (admin-entered free
    // text), so each is normalized at comparison time too — .includes() alone would
    // silently reject a valid user against e.g. an allowedDomains entry of 'Corp.Example.Com'.
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (
      !emailDomain ||
      !idpConfig.allowedDomains.some((domain) => domain.toLowerCase() === emailDomain)
    ) {
      return unauthorized(reply);
    }

    const existingUser = await db.users.findByEmail(email);
    if (existingUser) {
      const membership = await db.organizationMembers.findMembership(tenantId, existingUser.id);
      if (!membership) {
        return unauthorized(reply);
      }
      return issueOidcCookie(fastify, reply, existingUser);
    }

    // users.create() + organizationMembers.createWithUser() must be atomic: if the
    // membership insert fails or returns null after the user row is already committed, a
    // later callback for this same email finds an orphaned global user with no membership
    // anywhere, and the cross-tenant-reject branch above would then reject it forever.
    // db.transaction(async tx => ...) is this codebase's established pattern for exactly
    // this (see e.g. signup.service.ts) — throwing inside the callback on a null
    // membership rolls back the user insert too, instead of returning 401 while leaving
    // it committed.
    let newUser: User;
    try {
      newUser = await db.transaction(async (tx) => {
        const user = await tx.users.create({
          email,
          name: typeof claims.name === 'string' ? claims.name : undefined,
        });
        const created = await tx.organizationMembers.createWithUser(tenantId, user.id, 'member');
        if (!created) {
          throw new Error('OIDC callback: membership creation returned null for a new user');
        }
        return user;
      });
    } catch {
      return unauthorized(reply);
    }
    return issueOidcCookie(fastify, reply, newUser);
  }
}

// Cookie must match auth.ts exactly: name `refresh_token`, options built via
// buildRefreshCookieOptions() from packages/backend/src/api/utils/auth-cookies.ts. No
// post-login frontend redirect destination is configured anywhere in this codebase yet, so
// this mirrors the 200 JSON shape auth.ts's other session-issuing routes already return
// (user + access_token + expires_in + token_type) instead of inventing a redirect target.
async function issueOidcCookie(fastify: FastifyInstance, reply: FastifyReply, user: User) {
  const tokens = generateAuthTokens(fastify, user);
  reply.setCookie(
    'refresh_token',
    tokens.refresh_token,
    buildRefreshCookieOptions(tokens.refresh_expires_in)
  );
  return sendSuccess(reply, {
    user: omitFields(user, 'password_hash'),
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
    token_type: tokens.token_type,
  });
}
