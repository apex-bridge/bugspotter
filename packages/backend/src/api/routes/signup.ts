/**
 * Self-service signup route
 *
 * POST /api/v1/auth/signup
 *
 * Sentry-style instant onboarding: one atomic call provisions user +
 * organization + trial subscription + default project + ingest-only
 * custom-scope API key (limited to `reports:write` + `sessions:write`,
 * with no read access). Returns JWTs + plaintext key in a single
 * response. The landing wizard on `kz.bugspotter.io` calls this;
 * enterprise/admin-approval flow lives at `/organization-requests`
 * unchanged.
 *
 * Separate from `/auth/register` (which is user-only and does not create
 * an organization) to keep the invite-flow contract stable.
 *
 * Rate limiting: This endpoint overrides the default per-route rate limit
 * with a stricter 5/minute/IP cap — genuine users never rapid-fire signups.
 * NOTE: effectiveness depends on `trustProxy` being configured when behind
 * a reverse proxy (CDN/Vercel/nginx) so `request.ip` reflects the real
 * client IP rather than the proxy's. That wiring is deployment-topology
 * config, not code, but is called out in the project plan as a
 * pre-prod blocker.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { config } from '../../config.js';
import { AppError } from '../middleware/error.js';
import { omitFields } from '../utils/resource.js';
import { sendCreated, sendSuccess } from '../utils/response.js';
import { buildRefreshCookieOptions } from '../utils/auth-cookies.js';
import { generateAuthTokens } from '../utils/auth-tokens.js';
import {
  signupSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from '../schemas/auth-schema.js';
import { requireUser } from '../middleware/auth.js';
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
  // Parse region ONCE at route-registration time. Config is already validated
  // by `validateConfig('api')` at server boot, so this throw is a belt-and-
  // braces guard for the theoretical "someone called signupRoutes without
  // validating config first" case — we still prefer a boot failure to a
  // per-request 500.
  const region = parseDataResidencyRegion(config.dataResidency.region);
  const service = new SignupService(db, region);

  fastify.post<{ Body: SignupBody }>(
    '/api/v1/auth/signup',
    {
      schema: signupSchema,
      config: {
        public: true,
        // Per-IP burst cap — tighter than the global default because this
        // endpoint creates real tenant data and must resist credential-
        // stuffing / subdomain-squatting bots. Honeypot and fail-closed
        // SpamFilter are complementary, not substitutes.
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      if (!config.auth.selfServiceSignupEnabled) {
        throw new AppError('Self-service signup is disabled', 403, 'Forbidden');
      }

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

  /**
   * POST /api/v1/auth/verify-email
   *
   * Public — the user clicks a link in their email after signup. The
   * token IS the auth, so we don't require a session here. Validates
   * + consumes the token, sets users.email_verified_at = NOW().
   *
   * Rate-limited the same way as signup: a malicious client trying to
   * brute-force valid tokens would have to do so behind the per-IP
   * cap. Token entropy (32 bytes) makes guessing infeasible anyway,
   * but a low cap is cheap defense in depth.
   */
  fastify.post<{ Body: { token: string } }>(
    '/api/v1/auth/verify-email',
    {
      schema: verifyEmailSchema,
      config: {
        public: true,
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      if (!config.auth.selfServiceSignupEnabled) {
        throw new AppError('Self-service signup is disabled', 403, 'Forbidden');
      }
      await service.verifyEmail(request.body.token);
      return sendSuccess(reply, { email_verified: true });
    }
  );

  /**
   * POST /api/v1/auth/resend-verification
   *
   * Authenticated — only the signed-in user can ask to resend their
   * own verification email. Tighter rate limit than signup: an authed
   * user pressing the button repeatedly should hit a low cap fast,
   * which both protects SMTP capacity and discourages email-bombing.
   */
  fastify.post(
    '/api/v1/auth/resend-verification',
    {
      schema: resendVerificationSchema,
      preHandler: [requireUser],
      config: {
        rateLimit: { max: 3, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      if (!config.auth.selfServiceSignupEnabled) {
        throw new AppError('Self-service signup is disabled', 403, 'Forbidden');
      }
      // requireUser guarantees authUser is present; non-null assertion
      // mirrors the pattern used elsewhere in this file.
      const user = request.authUser!;
      await service.resendVerification(user.id);
      // Same 200 whether the user was already verified or we just sent
      // a fresh token — keeping the response shape stable avoids
      // leaking verification state in a probe-able way.
      return sendSuccess(reply, {
        message: 'If your email is unverified, a new link has been sent.',
      });
    }
  );
}
