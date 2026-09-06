/**
 * Audit body sanitization (#438).
 *
 * The global audit hook writes `sanitizeData(request.body)` into
 * `audit_logs.details`, a durable table readable through /api/v1/audit-logs.
 * Redaction used to be an exact match on a fixed list of field names, which is
 * why it needed both `api_key` and `apikey` spelled out - and why
 * `clientSecret`, the OIDC credential posted to PUT /organizations/:id/sso,
 * would have been written to that table in plaintext.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeData } from '../../../src/api/middleware/audit.js';

describe('sanitizeData', () => {
  it('redacts the OIDC client secret whatever the casing convention', () => {
    // The regression that prompted this: camelCase is what the admin client
    // sends, snake_case is what the repository layer uses.
    for (const key of ['clientSecret', 'client_secret', 'CLIENTSECRET']) {
      const result = sanitizeData({ [key]: 'super-secret-value' });
      expect(result?.[key]).toBe('[REDACTED]');
    }
  });

  it('still redacts the originally-listed fields', () => {
    const result = sanitizeData({
      password: 'p',
      api_key: 'k',
      apikey: 'k',
      token: 't',
      refresh_token: 'r',
      jwt: 'j',
    });

    for (const value of Object.values(result ?? {})) {
      expect(value).toBe('[REDACTED]');
    }
  });

  it('redacts secrets nested inside objects and arrays', () => {
    const result = sanitizeData({
      config: { oidc: { clientSecret: 'nested-secret' } },
      items: [{ userPassword: 'in-an-array' }],
    });

    expect(JSON.stringify(result)).not.toContain('nested-secret');
    expect(JSON.stringify(result)).not.toContain('in-an-array');
  });

  it('redacts camelCase credential fields, not just the snake_case spellings', () => {
    // The enumerated list only ever held snake_case, so these fell through the
    // same way `clientSecret` did. `integrations.ts` accepts
    // `credentials: Record<string, unknown>` - arbitrary client-named keys -
    // so the camelCase spellings genuinely reach the audit log.
    const result = sanitizeData({
      accessToken: 'a',
      refreshToken: 'r',
      authToken: 'au',
      sessionToken: 's',
      resetToken: 're',
      bearerToken: 'b',
    });

    for (const [key, value] of Object.entries(result ?? {})) {
      expect(value, `${key} must be redacted`).toBe('[REDACTED]');
    }
  });

  it('leaves token-count style fields alone', () => {
    // The rule is "ends with token", not "contains token", precisely so these
    // survive - over-redacting them would gut audit detail to no security
    // benefit. `maxTokens` is plural and so does not match either.
    const result = sanitizeData({
      tokenCount: 1234,
      maxTokens: 8000,
      tokenLimit: 32,
      tokensUsed: 7,
    });

    expect(result).toEqual({
      tokenCount: 1234,
      maxTokens: 8000,
      tokenLimit: 32,
      tokensUsed: 7,
    });
  });

  it('leaves ordinary SSO config fields readable', () => {
    // The audit record is still supposed to say what changed.
    const result = sanitizeData({
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-abc',
      allowedDomains: ['example.com'],
      enforceSso: true,
      clientSecret: 'should-not-appear',
    });

    expect(result).toMatchObject({
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-abc',
      enforceSso: true,
      clientSecret: '[REDACTED]',
    });
  });

  it('returns null for non-object input', () => {
    expect(sanitizeData(null)).toBeNull();
    expect(sanitizeData('a string')).toBeNull();
  });

  it('sanitizes a top-level array body and returns it as an array', () => {
    // `typeof [] === 'object'`, so an array body has always reached the
    // recursive walk; the old signature just claimed otherwise via a cast.
    // A JSON array body can carry credentials in its elements, so sanitizing
    // it is the point - the type now says what it does.
    const result = sanitizeData([{ clientSecret: 'a' }, { accessToken: 'b' }]);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ clientSecret: '[REDACTED]' }, { accessToken: '[REDACTED]' }]);
  });
});
