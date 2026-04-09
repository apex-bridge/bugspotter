/**
 * Tests for authentication utilities
 */

import { describe, it, expect } from 'vitest';
import { buildAuthHeader } from '../../../src/integrations/plugin-utils/auth.js';
import type { AuthConfig } from '../../../src/integrations/plugin-utils/auth.js';

describe('Plugin Utils - Authentication', () => {
  describe('buildAuthHeader', () => {
    it('should build Basic auth header', () => {
      const config: AuthConfig = {
        type: 'basic',
        username: 'user@example.com',
        password: 'api-token-123',
      };

      const header = buildAuthHeader(config);

      // Base64 encode "user@example.com:api-token-123"
      const expected = 'Basic ' + Buffer.from('user@example.com:api-token-123').toString('base64');
      expect(header).toBe(expected);
    });

    it('should build Bearer token header', () => {
      const config: AuthConfig = {
        type: 'bearer',
        token: 'abc123xyz',
      };

      const header = buildAuthHeader(config);

      expect(header).toBe('Bearer abc123xyz');
    });

    it('should build OAuth2 token header', () => {
      const config: AuthConfig = {
        type: 'oauth2',
        token: 'oauth-token-456',
      };

      const header = buildAuthHeader(config);

      expect(header).toBe('Bearer oauth-token-456');
    });

    it('should build PAT token header', () => {
      const config: AuthConfig = {
        type: 'pat',
        token: 'pat-token-789',
      };

      const header = buildAuthHeader(config);

      expect(header).toBe('Bearer pat-token-789');
    });

    it('should build API key header (raw)', () => {
      const config: AuthConfig = {
        type: 'api-key',
        token: 'sk-1234567890',
      };

      const header = buildAuthHeader(config);

      expect(header).toBe('sk-1234567890');
    });

    it('should build custom auth header', () => {
      const config: AuthConfig = {
        type: 'custom',
        headerValue: 'Token custom-value',
      };

      const header = buildAuthHeader(config);

      expect(header).toBe('Token custom-value');
    });

    it('should throw error for basic auth without username', () => {
      const config: AuthConfig = {
        type: 'basic',
        password: 'token',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('Basic auth requires username and password');
    });

    it('should throw error for basic auth without password', () => {
      const config: AuthConfig = {
        type: 'basic',
        username: 'user@example.com',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('Basic auth requires username and password');
    });

    it('should throw error for bearer auth without token', () => {
      const config: AuthConfig = {
        type: 'bearer',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('bearer auth requires token');
    });

    it('should throw error for oauth2 without token', () => {
      const config: AuthConfig = {
        type: 'oauth2',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('oauth2 auth requires token');
    });

    it('should throw error for PAT without token', () => {
      const config: AuthConfig = {
        type: 'pat',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('pat auth requires token');
    });

    it('should throw error for API key without token', () => {
      const config: AuthConfig = {
        type: 'api-key',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('API key auth requires token');
    });

    it('should throw error for custom auth without headerValue', () => {
      const config: AuthConfig = {
        type: 'custom',
      } as any;

      expect(() => buildAuthHeader(config)).toThrow('Custom auth requires headerValue');
    });
  });
});
