/**
 * Authentication schemas for request/response validation
 */

const userRoleEnum = ['admin', 'user', 'viewer'] as const;

export const userSchema = {
  type: 'object',
  required: ['id', 'email', 'role', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string', nullable: true },
    role: { type: 'string', enum: userRoleEnum },
    oauth_provider: { type: 'string', nullable: true },
    oauth_id: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

// Response token schema (no refresh_token - sent via httpOnly cookie)
export const authResponseTokenSchema = {
  type: 'object',
  required: ['access_token', 'expires_in', 'token_type'],
  properties: {
    access_token: { type: 'string' },
    expires_in: { type: 'number' },
    token_type: { type: 'string', enum: ['Bearer'], default: 'Bearer' },
  },
} as const;

export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['user', 'access_token', 'expires_in', 'token_type'],
          properties: {
            user: userSchema,
            access_token: { type: 'string' },
            expires_in: { type: 'number' },
            token_type: { type: 'string', enum: ['Bearer'] },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      name: { type: 'string', minLength: 1, maxLength: 128 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      invite_token: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['user', 'access_token', 'expires_in', 'token_type'],
          properties: {
            user: userSchema,
            access_token: { type: 'string' },
            expires_in: { type: 'number' },
            token_type: { type: 'string', enum: ['Bearer'] },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const refreshTokenSchema = {
  body: {
    type: 'object',
    properties: {}, // Empty - refresh_token comes from httpOnly cookie
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['access_token', 'expires_in', 'token_type'],
          properties: {
            access_token: { type: 'string' },
            expires_in: { type: 'number' },
            token_type: { type: 'string', enum: ['Bearer'] },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const magicLoginSchema = {
  body: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['user', 'access_token', 'expires_in', 'token_type'],
          properties: {
            user: userSchema,
            access_token: { type: 'string' },
            expires_in: { type: 'number' },
            token_type: { type: 'string', enum: ['Bearer'] },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const signupSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'company_name'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      name: { type: 'string', minLength: 1, maxLength: 128 },
      company_name: { type: 'string', minLength: 1, maxLength: 128 },
      subdomain: { type: 'string', minLength: 3, maxLength: 63 },
      // Honeypot: must be empty/absent for humans. Bots auto-fill visible
      // form fields, including ones hidden via CSS.
      website: { type: 'string', maxLength: 256 },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: [
            'user',
            'organization',
            'project',
            'api_key',
            'access_token',
            'expires_in',
            'token_type',
          ],
          properties: {
            user: userSchema,
            organization: {
              type: 'object',
              required: ['id', 'name', 'subdomain'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                subdomain: { type: 'string' },
                trial_ends_at: { type: 'string', format: 'date-time', nullable: true },
              },
            },
            project: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
              },
            },
            api_key: { type: 'string' },
            api_key_id: { type: 'string', format: 'uuid' },
            access_token: { type: 'string' },
            expires_in: { type: 'number' },
            token_type: { type: 'string', enum: ['Bearer'] },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const registrationStatusSchema = {
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['allowed', 'requireInvitation'],
          properties: {
            allowed: { type: 'boolean' },
            requireInvitation: { type: 'boolean' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;
