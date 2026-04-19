/**
 * Self-service signup route
 *
 * POST /api/v1/auth/signup
 *
 * Sentry-style instant onboarding: one atomic call provisions user +
 * organization + trial subscription + default project + write-scoped API
 * key, returns JWTs + plaintext key in a single response. The landing
 * wizard on `kz.bugspotter.io` calls this; enterprise/admin-approval flow
 * lives at `/organization-requests` unchanged.
 *
 * Separate from `/auth/register` (which is user-only and does not create
 * an organization) to keep the invite-flow contract stable.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { config } from '../../config.js';
import { AppError } from '../middleware/error.js';
import { omitFields } from '../utils/resource.js';
import { sendCreated } from '../utils/response.js';
import { buildRefreshCookieOptions } from '../utils/auth-cookies.js';
import { generateAuthTokens } from '../utils/auth-tokens.js';
import { signupSchema } from '../schemas/auth-schema.js';
import {
  SignupService,
  parseDataResidencyRegion,
  type SignupInput,
} from '../../saas/services/signup.service.js';

interface SignupBody {
  email: string;
  password: string;
  name?: string;
  company_name: string;
  subdomain?: string;
  /** Honeypot — named `website` in the form to look like a legitimate field to bots. */
  website?: string;
}

export function signupRoutes(fastify: FastifyInstance, db: DatabaseClient): void {
  fastify.post<{ Body: SignupBody }>(
    '/api/v1/auth/signup',
    {
      schema: signupSchema,
      config: { public: true },
    },
    async (request, reply) => {
      if (!config.auth.selfServiceSignupEnabled) {
        throw new AppError('Self-service signup is disabled', 403, 'Forbidden');
      }

      const region = parseDataResidencyRegion(config.dataResidency.region);
      const service = new SignupService(db, region);

      const input: SignupInput = {
        email: request.body.email,
        password: request.body.password,
        name: request.body.name,
        company_name: request.body.company_name,
        subdomain: request.body.subdomain,
        ip_address: request.ip,
        honeypot: request.body.website ?? null,
      };

      const result = await service.signup(input);

      // Issue session JWTs so the wizard can hand off to the tenant admin UI
      // without a separate /login round-trip.
      const tokens = generateAuthTokens(fastify, result.user);

      reply.setCookie(
        'refresh_token',
        tokens.refresh_token,
        buildRefreshCookieOptions(tokens.refresh_expires_in)
      );

      const userWithoutPassword = omitFields(result.user, 'password_hash');

      return sendCreated(reply, {
        user: userWithoutPassword,
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          subdomain: result.organization.subdomain,
          trial_ends_at: result.organization.trial_ends_at,
        },
        project: {
          id: result.project.id,
          name: result.project.name,
        },
        api_key: result.api_key,
        api_key_id: result.api_key_id,
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      });
    }
  );
}
