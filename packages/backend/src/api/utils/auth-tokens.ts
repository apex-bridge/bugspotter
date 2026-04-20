/**
 * Shared JWT token generation helper.
 *
 * One source of truth for access/refresh token payloads + expiry so
 * `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/magic-login`,
 * and `/auth/signup` cannot drift apart. Per-flow behavior (cookie
 * attributes, response shape) lives in the route handler.
 */

import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import type { User } from '../../db/types.js';
import { isPlatformAdmin } from '../middleware/auth.js';
import { parseTimeString, DEFAULT_TOKEN_EXPIRY_SECONDS } from './constants.js';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: 'Bearer';
}

export function generateAuthTokens(fastify: FastifyInstance, user: User): AuthTokens {
  const payload = { userId: user.id, isPlatformAdmin: isPlatformAdmin(user) };

  const access_token = fastify.jwt.sign(payload, {
    expiresIn: config.jwt.expiresIn,
  });

  const refresh_token = fastify.jwt.sign(payload, {
    expiresIn: config.jwt.refreshExpiresIn,
  });

  const expiresIn = parseTimeString(config.jwt.expiresIn, DEFAULT_TOKEN_EXPIRY_SECONDS);
  const refreshExpiresIn = parseTimeString(
    config.jwt.refreshExpiresIn,
    DEFAULT_TOKEN_EXPIRY_SECONDS
  );

  return {
    access_token,
    refresh_token,
    expires_in: expiresIn,
    refresh_expires_in: refreshExpiresIn,
    token_type: 'Bearer',
  };
}
