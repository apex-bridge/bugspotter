/**
 * Authentication routes
 * User registration, login, and token refresh
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import bcrypt from 'bcrypt';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  magicLoginSchema,
  registrationStatusSchema,
} from '../schemas/auth-schema.js';
import { AppError } from '../middleware/error.js';
import { config } from '../../config.js';
import { InvitationService } from '../../saas/services/invitation.service.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { findOrThrow, omitFields } from '../utils/resource.js';
import { PASSWORD } from '../utils/constants.js';
import {
  buildRefreshCookieOptions,
  buildClearRefreshCookieOptions,
} from '../utils/auth-cookies.js';
import { generateAuthTokens } from '../utils/auth-tokens.js';
import {
  checkLockoutStatus,
  recordFailedAttempt,
  clearFailedAttempts,
} from '../../services/auth/login-lockout.js';
import { sendAccountLocked, sendUnauthorizedWithAttempts } from '../middleware/auth/responses.js';
import type { User } from '../../db/types.js';
import { isPlatformAdmin } from '../middleware/auth.js';
import { getDeploymentConfig } from '../../saas/config.js';

/**
 * SaaS-mode access gate: reject the caller if the user has zero
 * non-deleted org memberships. Used at both login and refresh time
 * so a leaked refresh cookie against a "deleted" tenant doesn't
 * keep minting access tokens. Selfhosted is exempt (saas schema
 * is empty there by design); platform admins are exempt (they may
 * legitimately have no membership rows).
 *
 * Throws `AppError(403, 'OrgAccessRevoked')` when access is denied.
 * Callers that re-wrap thrown errors should let this 403 pass
 * through with its original status — see the refresh handler's
 * try/catch for the pattern.
 */
async function assertUserHasActiveOrgAccess(db: DatabaseClient, user: User): Promise<void> {
  if (!getDeploymentConfig().features.multiTenancy) {
    return;
  }
  if (isPlatformAdmin(user)) {
    return;
  }
  const activeOrgs = await db.organizations.findByUserId(user.id);
  if (activeOrgs.length === 0) {
    throw new AppError(
      'Access has been revoked. Contact support if you believe this is an error.',
      403,
      'OrgAccessRevoked'
    );
  }
}

interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody {
  email: string;
  name?: string;
  password: string;
  invite_token?: string;
}

interface RefreshTokenBody {
  refresh_token: string;
}

/**
 * Generate a magic token for passwordless authentication
 * Used for demo users and email-based login links
 *
 * @param fastify - Fastify instance with JWT plugin
 * @param user - User object
 * @param organizationId - Organization ID the token is scoped to
 * @param expiresIn - Token expiration (default: '24h')
 * @returns Magic token string that can be used in URL query parameter
 *
 * @example
 * const magicToken = generateMagicToken(fastify, user, orgId, '48h');
 * const loginUrl = `https://demo.bugspotter.io/login?token=${magicToken}`;
 */
export function generateMagicToken(
  fastify: FastifyInstance,
  user: User,
  organizationId: string,
  expiresIn: string = '24h'
): string {
  const payload = {
    userId: user.id,
    isPlatformAdmin: isPlatformAdmin(user),
    organizationId,
    type: 'magic', // Distinguishes from regular access tokens
  };

  return fastify.jwt.sign(payload, { expiresIn });
}

/**
 * Validate JWT payload structure
 * Ensures payload has required userId (or sub) and optional isPlatformAdmin boolean.
 * Accepts both 'userId' (custom) and 'sub' (standard JWT claim) for flexibility.
 * Legacy 'role' field is accepted but no longer required (backward compat).
 *
 * @param decoded - Decoded JWT payload
 * @throws AppError if payload structure is invalid
 */
export function validateJwtPayload(
  decoded: unknown
): asserts decoded is { userId: string; isPlatformAdmin?: boolean; role?: string } {
  if (!decoded || typeof decoded !== 'object') {
    throw new AppError('Invalid token payload', 401, 'Unauthorized');
  }

  const payload = decoded as Record<string, unknown>;

  // Accept either 'userId' (custom) or 'sub' (standard JWT claim)
  const userId = payload.userId || payload.sub;
  if (!userId || typeof userId !== 'string') {
    throw new AppError('Invalid token: missing or invalid user identifier', 401, 'Unauthorized');
  }

  // role is optional (removed from new tokens, may exist in old ones)
  if (payload.role !== undefined && typeof payload.role !== 'string') {
    throw new AppError('Invalid token: role must be a string', 401, 'Unauthorized');
  }

  if (payload.isPlatformAdmin !== undefined && typeof payload.isPlatformAdmin !== 'boolean') {
    throw new AppError('Invalid token: isPlatformAdmin must be boolean', 401, 'Unauthorized');
  }

  // Normalize to 'userId' for consistent downstream usage
  if (payload.sub && !payload.userId) {
    payload.userId = payload.sub as string;
  }
}

export function authRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * POST /api/v1/auth/register
   * Create a new user account
   */
  fastify.post<{ Body: RegisterBody }>(
    '/api/v1/auth/register',
    {
      schema: registerSchema,
      config: { public: true },
    },
    async (request, reply) => {
      if (!config.auth.allowRegistration) {
        throw new AppError('Registration is currently disabled', 403, 'Forbidden');
      }

      const { email, name, password, invite_token } = request.body;

      // Validate invitation token when invitation-only registration is enabled
      if (config.auth.requireInvitationToRegister) {
        if (!invite_token) {
          throw new AppError('Registration requires an invitation', 403, 'InvitationRequired');
        }

        const invitationService = new InvitationService(db);
        const invitation = await invitationService.validatePendingToken(invite_token);

        if (email.toLowerCase().trim() !== invitation.email.toLowerCase().trim()) {
          throw new AppError('Email does not match the invitation', 403, 'EmailMismatch');
        }
      }

      // Check if user already exists
      const existing = await db.users.findByEmail(email);
      if (existing) {
        throw new AppError('User with this email already exists', 409, 'Conflict');
      }

      // Hash password
      const password_hash = await bcrypt.hash(password, PASSWORD.SALT_ROUNDS);

      // Create user (role is always 'user' — admin accounts are created via admin endpoints only)
      const user = await db.users.create({
        email,
        name: name || null,
        password_hash,
        role: 'user',
      });

      // Auto-accept any pending organization invitations for this email
      const invitationService = new InvitationService(db);
      await invitationService.autoAcceptPendingInvitations(email, user.id);

      // Generate tokens
      const tokens = generateAuthTokens(fastify, user);

      // Set refresh token in httpOnly cookie
      reply.setCookie(
        'refresh_token',
        tokens.refresh_token,
        buildRefreshCookieOptions(tokens.refresh_expires_in)
      );

      // Remove password hash from response
      const userWithoutPassword = omitFields(user, 'password_hash');

      return sendCreated(reply, {
        user: userWithoutPassword,
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      });
    }
  );

  /**
   * POST /api/v1/auth/login
   * Authenticate user with email and password
   *
   * Security: Implements account lockout after 5 failed attempts.
   * Locked accounts must wait 15 minutes before retrying.
   */
  fastify.post<{ Body: LoginBody }>(
    '/api/v1/auth/login',
    {
      schema: loginSchema,
      config: { public: true },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      /**
       * Handle failed login attempt - records attempt and returns appropriate error response
       */
      const handleFailedAttempt = async () => {
        const status = await recordFailedAttempt(email);
        if (status.isLocked) {
          return sendAccountLocked(reply, status.lockoutSecondsRemaining);
        }
        return sendUnauthorizedWithAttempts(
          reply,
          'Invalid email or password',
          status.remainingAttempts
        );
      };

      // Check if account is locked before processing
      const lockoutResult = await checkLockoutStatus(email);
      if (!lockoutResult.canAttempt) {
        return sendAccountLocked(reply, lockoutResult.status.lockoutSecondsRemaining);
      }

      // Find user by email
      const user = await db.users.findByEmail(email);
      if (!user) {
        // Record failed attempt for non-existent users too (prevents user enumeration timing attacks)
        return handleFailedAttempt();
      }

      // Verify password
      if (!user.password_hash) {
        throw new AppError('Password login not available for this account', 401, 'Unauthorized');
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return handleFailedAttempt();
      }

      // Login successful - clear any failed attempts
      await clearFailedAttempts(email);

      // SaaS-mode access gate — see assertUserHasActiveOrgAccess.
      await assertUserHasActiveOrgAccess(db, user);

      // Generate tokens
      const tokens = generateAuthTokens(fastify, user);

      // Set refresh token in httpOnly cookie
      reply.setCookie(
        'refresh_token',
        tokens.refresh_token,
        buildRefreshCookieOptions(tokens.refresh_expires_in)
      );

      // Remove password hash from response
      const userWithoutPassword = omitFields(user, 'password_hash');

      return sendSuccess(reply, {
        user: userWithoutPassword,
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      });
    }
  );

  /**
   * POST /api/v1/auth/refresh
   * Refresh access token using refresh token from httpOnly cookie
   */
  fastify.post<{ Body: RefreshTokenBody }>(
    '/api/v1/auth/refresh',
    {
      schema: refreshTokenSchema,
      config: { public: true },
    },
    async (request, reply) => {
      // Try to get refresh token from cookie first (new secure method)
      let refresh_token = request.cookies.refresh_token;

      // Fallback to request body for backward compatibility
      if (!refresh_token && request.body?.refresh_token) {
        refresh_token = request.body.refresh_token;
      }

      if (!refresh_token) {
        throw new AppError('Refresh token not provided', 401, 'Unauthorized');
      }

      // Token-verify + user-lookup live inside the try/catch so any
      // failure collapses to a generic 401 (don't leak whether the
      // token was malformed vs. signed with the wrong key vs.
      // belonged to a now-missing user). The org-access check below
      // runs OUTSIDE the catch so the 403 OrgAccessRevoked surfaces
      // with its own status — without that, the catch would rewrite
      // it to 401 and the frontend's tailored "access revoked"
      // message wouldn't fire on refresh.
      let user: User;
      try {
        const decoded = fastify.jwt.verify(refresh_token);
        validateJwtPayload(decoded);
        user = await findOrThrow(() => db.users.findById(decoded.userId), 'User');
      } catch {
        throw new AppError('Invalid or expired refresh token', 401, 'Unauthorized');
      }

      // SaaS-mode access gate — applies on refresh too, so a leaked
      // refresh cookie against a "deleted" tenant stops minting access
      // tokens within at most one access-token TTL of the soft-delete.
      await assertUserHasActiveOrgAccess(db, user);

      // Generate new tokens
      const tokens = generateAuthTokens(fastify, user);

      // Set new refresh token in httpOnly cookie
      reply.setCookie(
        'refresh_token',
        tokens.refresh_token,
        buildRefreshCookieOptions(tokens.refresh_expires_in)
      );

      return sendSuccess(reply, {
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      });
    }
  );

  /**
   * POST /api/v1/auth/magic-login
   * Authenticate user with a magic token (JWT-based passwordless login)
   * Used for demo environments and email-based login links
   */
  fastify.post<{ Body: { token: string } }>(
    '/api/v1/auth/magic-login',
    {
      schema: magicLoginSchema,
      config: { public: true },
    },
    async (request, reply) => {
      const { token } = request.body;

      try {
        // Verify and decode magic token. Shape mirrors what
        // `validateJwtPayload` enforces — `userId` required, `role`
        // optional (older tokens may still carry it), `isPlatformAdmin`
        // optional. `type` and `organizationId` are magic-token-specific
        // and validated explicitly below.
        const decoded = fastify.jwt.verify(token) as {
          type?: string;
          userId: string;
          role?: string;
          organizationId?: string;
          isPlatformAdmin?: boolean;
        };

        // Validate payload structure
        validateJwtPayload(decoded);

        // Ensure this is actually a magic token (not a regular access token)
        if (decoded.type !== 'magic') {
          throw new AppError('Invalid token type', 401, 'Unauthorized');
        }

        // Validate organization scope
        if (!decoded.organizationId || typeof decoded.organizationId !== 'string') {
          throw new AppError(
            'Invalid magic token: missing organization scope',
            401,
            'Unauthorized'
          );
        }

        // Check if magic login is enabled for this organization (DB-backed setting)
        const org = await db.organizations.findById(decoded.organizationId);
        if (!org) {
          throw new AppError('Organization not found', 404, 'NotFound');
        }
        if (!org.settings?.magic_login_enabled) {
          throw new AppError('Magic login is not enabled for this organization', 403, 'Forbidden');
        }

        // Verify user still exists and is not deleted
        const user = await findOrThrow(() => db.users.findById(decoded.userId), 'User');

        // Verify user is a member of the organization
        const membership = await db.organizationMembers.findMembership(
          decoded.organizationId,
          user.id
        );
        if (!membership) {
          throw new AppError('User is not a member of this organization', 403, 'Forbidden');
        }

        // Generate regular access/refresh tokens for the session
        const tokens = generateAuthTokens(fastify, user);

        // Set refresh token in httpOnly cookie
        reply.setCookie(
          'refresh_token',
          tokens.refresh_token,
          buildRefreshCookieOptions(tokens.refresh_expires_in)
        );

        // Remove password hash from response
        const userWithoutPassword = omitFields(user, 'password_hash');

        return sendSuccess(reply, {
          user: userWithoutPassword,
          access_token: tokens.access_token,
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
        });
      } catch (error) {
        // Handle JWT verification errors
        if (error instanceof Error && error.name === 'TokenExpiredError') {
          throw new AppError('Magic token has expired', 401, 'Unauthorized');
        }
        if (error instanceof Error && error.name === 'JsonWebTokenError') {
          throw new AppError('Invalid magic token', 401, 'Unauthorized');
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/v1/auth/logout
   * Logout user and clear refresh token cookie
   */
  fastify.post(
    '/api/v1/auth/logout',
    {
      config: { public: true },
    },
    async (_request, reply) => {
      // Clear refresh token cookie
      reply.clearCookie('refresh_token', buildClearRefreshCookieOptions());

      return sendSuccess(reply, { message: 'Logged out successfully' });
    }
  );

  /**
   * GET /api/v1/auth/registration-status
   * Public endpoint — returns whether self-registration is enabled
   */
  fastify.get(
    '/api/v1/auth/registration-status',
    {
      schema: registrationStatusSchema,
      config: { public: true },
    },
    async (_request, reply) => {
      return sendSuccess(reply, {
        allowed: config.auth.allowRegistration,
        requireInvitation: config.auth.requireInvitationToRegister,
      });
    }
  );
}
