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

  it('leaves token-count style fields alone', () => {
    // `token` stays an exact match precisely so these survive - over-redacting
    // them would gut audit detail to no security benefit.
    const result = sanitizeData({ tokenCount: 1234, maxTokens: 8000 });

    expect(result).toEqual({ tokenCount: 1234, maxTokens: 8000 });
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
});
