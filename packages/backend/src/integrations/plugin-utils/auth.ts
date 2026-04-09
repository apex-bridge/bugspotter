/**
 * Authentication utilities for custom plugins
 * Supports common authentication patterns across ticketing platforms
 */

export interface AuthConfig {
  type: 'basic' | 'bearer' | 'oauth2' | 'pat' | 'api-key' | 'custom';
  username?: string;
  password?: string;
  token?: string;
  headerValue?: string;
}

/**
 * Build authentication header for various auth types
 * @param authConfig - Authentication configuration
 * @returns Authorization header value
 * @throws Error if auth type is unsupported
 * @example
 * // Basic auth
 * buildAuthHeader({ type: 'basic', username: 'user@example.com', password: 'api-token' })
 * // Returns: "Basic dXNlckBleGFtcGxlLmNvbTphcGktdG9rZW4="
 *
 * // Bearer token
 * buildAuthHeader({ type: 'bearer', token: 'abc123' })
 * // Returns: "Bearer abc123"
 */
export function buildAuthHeader(authConfig: AuthConfig): string {
  switch (authConfig.type) {
    case 'basic': {
      if (!authConfig.username || !authConfig.password) {
        throw new Error('Basic auth requires username and password');
      }
      const credentials = `${authConfig.username}:${authConfig.password}`;
      return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    case 'bearer':
    case 'oauth2':
    case 'pat': {
      if (!authConfig.token) {
        throw new Error(`${authConfig.type} auth requires token`);
      }
      return `Bearer ${authConfig.token}`;
    }

    case 'api-key': {
      if (!authConfig.token) {
        throw new Error('API key auth requires token');
      }
      return authConfig.token;
    }

    case 'custom': {
      if (!authConfig.headerValue) {
        throw new Error('Custom auth requires headerValue');
      }
      return authConfig.headerValue;
    }

    default: {
      throw new Error('Unsupported auth type');
    }
  }
}
