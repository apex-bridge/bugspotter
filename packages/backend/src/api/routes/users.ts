/**
 * User Management Routes
 * Admin-only endpoints for managing users
 */

import type { FastifyInstance } from 'fastify';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import bcrypt from 'bcrypt';
import type { UserRepository } from '../../db/repositories.js';
import type { User } from '../../db/types.js';
import {
  listUsersSchema,
  createUserSchema,
  updateUserSchema,
  deleteUserSchema,
  updateUserPreferencesSchema,
  getUserPreferencesSchema,
} from '../schemas/user-schema.js';
import { getUserProjectsSchema } from '../schemas/project-member-schema.js';
import { findOrThrow } from '../utils/resource.js';

const SALT_ROUNDS = 10;

export function userRoutes(fastify: FastifyInstance, userRepo: UserRepository) {
  // List users with pagination and filtering
  fastify.get(
    '/api/v1/admin/users',
    {
      preHandler: requirePlatformAdmin(),
      schema: listUsersSchema,
    },
    async (request, reply) => {
      const {
        page = 1,
        limit = 20,
        role,
        email,
      } = request.query as {
        page?: number;
        limit?: number;
        role?: 'admin' | 'user' | 'viewer';
        email?: string;
      };

      const result = await userRepo.listWithFilters({ page, limit, role, email });

      return reply.send({
        success: true,
        data: {
          users: result.data,
          pagination: result.pagination,
        },
      });
    }
  );

  // Create new user
  fastify.post(
    '/api/v1/admin/users',
    {
      preHandler: requirePlatformAdmin(),
      schema: createUserSchema,
    },
    async (request, reply) => {
      const { email, name, password, role, oauth_provider, oauth_id } = request.body as {
        email: string;
        name: string;
        password?: string;
        role: 'admin' | 'user' | 'viewer';
        oauth_provider?: string;
        oauth_id?: string;
      };

      // Check if user already exists
      const existingUser = await userRepo.findByEmail(email);
      if (existingUser) {
        throw new AppError('User with this email already exists', 409, 'Conflict');
      }

      // Hash password if provided (for non-OAuth users)
      let passwordHash: string | undefined;
      if (password) {
        passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      } else if (!oauth_provider || !oauth_id) {
        throw new AppError(
          'Password is required for non-OAuth users, or both oauth_provider and oauth_id must be provided',
          400,
          'BadRequest'
        );
      }

      // Create user
      const user = await userRepo.create({
        email,
        name,
        password_hash: passwordHash,
        role,
        oauth_provider,
        oauth_id,
      });

      // Remove password hash from response
      const { password_hash: _password_hash, ...userWithoutPassword } = user;

      return reply.code(201).send({
        success: true,
        data: userWithoutPassword,
      });
    }
  );

  // Update user
  fastify.patch(
    '/api/v1/admin/users/:id',
    {
      preHandler: requirePlatformAdmin(),
      schema: updateUserSchema,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { name, role, email } = request.body as {
        name?: string;
        role?: 'admin' | 'user' | 'viewer';
        email?: string;
      };

      // Check if user exists
      const user = await userRepo.findById(id);
      if (!user) {
        throw new AppError('User not found', 404, 'NotFound');
      }

      // Prevent users from changing their own role
      if (role && user.id === request.authUser?.id && user.role !== role) {
        throw new AppError('Cannot change your own role', 400, 'BadRequest');
      }

      // Check email uniqueness if being updated
      if (email && email !== user.email) {
        const existingUser = await userRepo.findByEmail(email);
        if (existingUser) {
          throw new AppError('Email already in use', 409, 'Conflict');
        }
      }

      // Update user
      const updates: { name?: string; role?: string; email?: string } = {};
      if (name) {
        updates.name = name;
      }
      if (role) {
        updates.role = role;
      }
      if (email) {
        updates.email = email;
      }

      const updated = await userRepo.update(id, updates as Partial<User>);
      if (!updated) {
        throw new AppError('User not found', 404, 'NotFound');
      }

      // Remove password hash from response
      const { password_hash: _password_hash2, ...userWithoutPassword } = updated;

      return reply.send({
        success: true,
        data: userWithoutPassword,
      });
    }
  );

  // Delete user
  fastify.delete(
    '/api/v1/admin/users/:id',
    {
      preHandler: requirePlatformAdmin(),
      schema: deleteUserSchema,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Check if user exists
      const user = await userRepo.findById(id);
      if (!user) {
        throw new AppError('User not found', 404, 'NotFound');
      }

      // Prevent users from deleting themselves
      if (user.id === request.authUser?.id) {
        throw new AppError('Cannot delete your own account', 400, 'BadRequest');
      }

      // Delete user
      await userRepo.delete(id);

      return reply.send({
        success: true,
        message: 'User deleted successfully',
      });
    }
  );

  // Get user's projects
  fastify.get(
    '/api/v1/admin/users/:id/projects',
    {
      preHandler: requirePlatformAdmin(),
      schema: getUserProjectsSchema,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Check if user exists
      await findOrThrow(() => userRepo.findById(id), 'User');

      // Get user's projects with their role (including owned projects)
      const projects = await userRepo.getUserProjects(id);

      return reply.send({
        success: true,
        data: projects,
      });
    }
  );

  // Get current user's preferences
  fastify.get(
    '/api/v1/users/me/preferences',
    {
      schema: getUserPreferencesSchema,
    },
    async (request, reply) => {
      const userId = request.authUser?.id;
      if (!userId) {
        throw new AppError('Unauthorized', 401, 'Unauthorized');
      }

      const user = await userRepo.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404, 'NotFound');
      }

      return reply.send({
        success: true,
        data: user.preferences || {},
      });
    }
  );

  // Update current user's preferences (merge with existing)
  fastify.patch<{ Body: Record<string, unknown> }>(
    '/api/v1/users/me/preferences',
    {
      schema: updateUserPreferencesSchema,
    },
    async (request, reply) => {
      const userId = request.authUser?.id;
      if (!userId) {
        throw new AppError('Unauthorized', 401, 'Unauthorized');
      }

      // Request body is validated by Fastify schema before reaching here
      // Only allowed keys are present: language, theme
      const incomingPreferences = request.body as Record<string, unknown>;

      // Fetch current user to get existing preferences
      const user = await userRepo.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404, 'NotFound');
      }

      // Merge incoming preferences with existing ones
      // This preserves preferences not being updated
      const mergedPreferences: Record<string, unknown> = {
        ...(user.preferences || {}),
        ...incomingPreferences,
      };

      // Update user preferences with merged object
      const updated = await userRepo.update(userId, {
        preferences: mergedPreferences,
      });

      return reply.send({
        success: true,
        data: updated?.preferences || {},
      });
    }
  );
}
