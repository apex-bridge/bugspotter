/**
 * User Management API Tests
 * Tests for user CRUD operations and password validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('User Management API', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let adminToken: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Clean up users table
    await db.query('DELETE FROM users');

    // Create admin user directly in database
    const admin = await db.users.create({
      email: 'admin@example.com',
      password_hash: 'hashed',
      role: 'admin',
    });

    // Generate JWT token manually
    adminToken = server.jwt.sign({ userId: admin.id, role: 'admin' }, { expiresIn: '1h' });
  });

  describe('POST /api/v1/users - Password Validation', () => {
    it('should reject password shorter than 8 characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'newuser@example.com',
          name: 'New User',
          password: 'short', // Only 5 characters
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should reject password longer than 128 characters', async () => {
      const longPassword = 'a'.repeat(129); // 129 characters

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'newuser@example.com',
          name: 'New User',
          password: longPassword,
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should accept password with exactly 8 characters (minimum)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'minpass@example.com',
          name: 'Min Pass User',
          password: 'Pass1234', // Exactly 8 characters
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.email).toBe('minpass@example.com');
    });

    it('should accept password with exactly 128 characters (maximum)', async () => {
      const maxPassword = 'a'.repeat(128); // Exactly 128 characters

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'maxpass@example.com',
          name: 'Max Pass User',
          password: maxPassword,
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.email).toBe('maxpass@example.com');
    });

    it('should accept password with valid length (12 characters)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'validuser@example.com',
          name: 'Valid User',
          password: 'ValidPass123', // 12 characters
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.email).toBe('validuser@example.com');
      expect(json.data.name).toBe('Valid User');
      expect(json.data.role).toBe('user');
      expect(json.data.id).toBeDefined();
      expect(json.data.created_at).toBeDefined();
      // password_hash should NOT be returned
      expect(json.data.password_hash).toBeUndefined();
    });
  });

  describe('POST /api/v1/users - General Validation', () => {
    it('should require email field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'No Email User',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should require name field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'noname@example.com',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should require role field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'norole@example.com',
          name: 'No Role User',
          password: 'SecurePass123',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should validate email format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'not-an-email',
          name: 'Invalid Email',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should reject invalid role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'invalidrole@example.com',
          name: 'Invalid Role User',
          password: 'SecurePass123',
          role: 'superadmin', // Not in enum
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should accept valid user role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'userrole@example.com',
          name: 'User Role',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.role).toBe('user');
    });

    it('should accept admin role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'adminrole@example.com',
          name: 'Admin Role',
          password: 'SecurePass123',
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.role).toBe('admin');
    });

    it('should accept viewer role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'viewerrole@example.com',
          name: 'Viewer Role',
          password: 'SecurePass123',
          role: 'viewer',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.role).toBe('viewer');
    });
  });

  describe('PATCH /api/v1/admin/users/:id - Update User', () => {
    it('should update user without password field', async () => {
      // Create a user first
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'updateme@example.com',
          name: 'Original Name',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      const userId = createResponse.json().data.id;

      // Update the user
      const updateResponse = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Updated Name',
          email: 'updated@example.com',
          role: 'admin',
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      const json = updateResponse.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Name');
      expect(json.data.email).toBe('updated@example.com');
      expect(json.data.role).toBe('admin');
    });

    it('should reject update with invalid UUID', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/users/not-a-uuid',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/admin/users/:id', () => {
    it('should delete user successfully', async () => {
      // Create a user first
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'deleteme@example.com',
          name: 'Delete Me',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      const userId = createResponse.json().data.id;

      // Delete the user
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/users/${userId}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(deleteResponse.statusCode).toBe(200);
      const json = deleteResponse.json();
      expect(json.success).toBe(true);

      // Verify user is deleted
      const user = await db.users.findById(userId);
      expect(user).toBeNull();
    });
  });

  describe('Authorization', () => {
    it('should require admin role for creating users', async () => {
      // Create a regular user
      const regularUser = await db.users.create({
        email: 'regularuser@example.com',
        password_hash: 'hashed',
        role: 'user',
      });

      const userToken = server.jwt.sign(
        { userId: regularUser.id, role: 'user' },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          email: 'newuser@example.com',
          name: 'New User',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        payload: {
          email: 'newuser@example.com',
          name: 'New User',
          password: 'SecurePass123',
          role: 'user',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Unauthorized');
    });
  });
});
