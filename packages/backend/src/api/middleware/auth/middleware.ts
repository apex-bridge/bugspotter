/**
 * Main authentication middleware
 * Orchestrates API key and JWT authentication flows
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import { ApiKeyService } from '../../../services/api-key/index.js';
import { handleNewApiKeyAuth, handleJwtAuth, handleShareTokenAuth } from './handlers.js';
import { sendUnauthorized, sendInternalError } from './responses.js';
import { jwtUserCanAttributeForApiKey } from '../../utils/audit-attribution.js';

/**
 * Authentication middleware factory
 * Validates API keys or JWT tokens and sets request context
 *
 * Routes can be marked as public by setting `config.public = true` in route options:
 * @example
 * fastify.get('/public-route', { config: { public: true } }, handler);
 */
export function createAuthMiddleware(db: DatabaseClient) {
  const apiKeyService = new ApiKeyService(db);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip authentication if route is marked as public
    if (request.routeOptions.config?.public) {
      return;
    }

    // Skip auth if route doesn't exist (will return 404 later)
    if (!request.routeOptions.url) {
      return;
    }

    // Skip if already authenticated (e.g., by preValidation hook for POST body)
    if (request.authShareToken || request.authUser || request.apiKey) {
      return;
    }

    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authorization = request.headers.authorization;

    // Try shareToken from query params (GET requests)
    // NOTE: POST body tokens are handled in preValidation hook after body parsing
    try {
      const success = await handleShareTokenAuth(request, db);
      if (success) {
        return;
      }
    } catch (error) {
      request.log.error({ error }, 'Error during share token authentication');
      return sendInternalError(reply, 'Authentication failed');
    }

    // Try API key authentication
    if (apiKeyHeader) {
      const startTime = Date.now();

      try {
        await handleNewApiKeyAuth(apiKeyHeader, apiKeyService, db, request, reply, startTime);
        // Closes the GH-97 dual-header gap: when a JWT is presented
        // alongside the api-key, capture the JWT user's id for AUDIT
        // ATTRIBUTION ONLY. `request.authUser` stays undefined — the
        // api-key remains the authoritative authz path (precedence
        // unchanged).
        //
        // Guard on `request.apiKey`, not on `handleNewApiKeyAuth`'s
        // return value. The handler returns `true` for revoked /
        // expired / inactive keys after sending a 401 (handlers.ts:
        // ~66-74) — that's "request was handled," not "authentication
        // succeeded." `request.apiKey` is only set on the genuine
        // success path (handlers.ts:91), so it's the right signal
        // for "should we record dual-header attribution." Without
        // this, a rejected api-key request with an accompanying valid
        // JWT would poison `audit_logs.user_id` with the JWT user's
        // id on a 401-rejected row.
        //
        // We also DB-verify the JWT user AND cross-check that the
        // user has access to the api-key's scope before recording
        // the claim:
        //
        //   - `jwtVerify()` confirms signature only, not that the
        //     claimed user exists or is active. Without the
        //     existence check, an actor with a leaked api-key could
        //     attribute to any deleted / disabled user by presenting
        //     their cached JWT.
        //   - The scope cross-check (`jwtUserCanAttributeForApiKey`)
        //     verifies the JWT user has an effective role on at
        //     least one of the api-key's allowed projects. Without
        //     it, an actor with two unrelated credentials — a leaked
        //     api-key for project P and a valid JWT for any user
        //     with no relationship to P — could plant that user.id
        //     as the audit actor on every request against P. That
        //     would make the audit trail strictly worse than the
        //     pre-PR-107 honest `user_id: null`. Full-scope api-keys
        //     have no verifiable project relationship; the helper
        //     returns false for those, so attribution falls back to
        //     null (matching pre-PR-107 shape for full-scope dual-
        //     header).
        //
        // On any failure we fall through silently; this must never
        // fail an otherwise-successful api-key request.
        if (request.apiKey && authorization?.startsWith('Bearer ')) {
          try {
            const decoded = await request.jwtVerify();
            if (decoded?.userId && typeof decoded.userId === 'string') {
              const user = await db.users.findById(decoded.userId);
              if (user) {
                const canAttribute = await jwtUserCanAttributeForApiKey(
                  db,
                  user.id,
                  request.apiKey
                );
                if (canAttribute) {
                  request.jwtUserIdentity = { id: user.id };
                }
              }
            }
          } catch (error) {
            // Invalid / expired / forged JWT alongside a valid
            // api-key. The api-key already authenticated the request;
            // we simply have no second identity to attribute.
            request.log.debug(
              { error },
              'Dual-header: JWT verify failed; recording api-key attribution only'
            );
          }
        }
        // Whether api-key auth succeeded or sent its own 401, we're
        // done at this layer — the JWT block below must not re-run.
        return;
      } catch (error) {
        request.log.error({ error }, 'Error during API key authentication');
        return sendInternalError(reply, 'Authentication failed');
      }
    }

    // Try JWT Bearer token authentication
    if (authorization?.startsWith('Bearer ')) {
      const success = await handleJwtAuth(request, reply, db);
      if (success) {
        return;
      }
      // Reply already sent by helper
      return;
    }

    // For POST requests, allow fallthrough to preValidation hook (body might have share token)
    if (request.method === 'POST') {
      return; // Don't fail auth yet, let preValidation hook check POST body
    }

    // No authentication provided
    return sendUnauthorized(
      reply,
      'Authentication required. Provide X-API-Key header or Authorization Bearer token'
    );
  };
}

/**
 * PreValidation hook for POST body authentication
 * Runs after body parsing to check for share tokens in request body
 *
 * CRITICAL: POST endpoints that use this middleware are designed EXCLUSIVELY
 * for share token authentication. The request schema requires `shareToken`
 * in the body, which means these endpoints cannot be used with API key/JWT
 * authentication alone.
 *
 * STRICT VALIDATION: If a shareToken is provided in the POST body, it MUST
 * be valid. Invalid share tokens cause authentication to fail immediately,
 * even if API key/JWT headers are present. This enforces the exclusive design:
 * POST endpoints with shareToken are for sharing only.
 *
 * When shareToken is present and valid in POST body, it takes priority over
 * API keys/JWT headers. This allows users to share specific bug reports even
 * when using API keys that don't have access to those reports' projects.
 */
export function createBodyAuthMiddleware(db: DatabaseClient) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip if route is public
    if (request.routeOptions.config?.public) {
      return;
    }

    // Only check POST requests with body
    if (request.method !== 'POST' || !request.body) {
      return;
    }

    // Check if shareToken is present in body
    const body = request.body as { shareToken?: string } | undefined;
    const hasShareToken = body?.shareToken && typeof body.shareToken === 'string';

    // If shareToken is present, it MUST be valid (fail fast on invalid tokens)
    if (hasShareToken) {
      try {
        const success = await handleShareTokenAuth(request, db);
        if (success) {
          // Clear previous authentication to prioritize shareToken
          request.authUser = undefined;
          request.apiKey = undefined;
          return;
        }
        // Invalid share token - fail authentication
        request.log.warn({ shareToken: body.shareToken }, 'Invalid share token in POST body');
        return sendUnauthorized(reply, 'Invalid share token');
      } catch (error) {
        request.log.error({ error }, 'Error during POST body share token authentication');
        return sendInternalError(reply, 'Authentication failed');
      }
    }
  };
}
