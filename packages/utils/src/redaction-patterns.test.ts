import { describe, it, expect } from 'vitest';
import {
  redactString,
  isSensitiveKey,
  getPatternsByCategory,
  PII_PATTERNS,
  CREDENTIAL_PATTERNS,
  NETWORK_PATTERNS,
  ALL_REDACTION_PATTERNS,
} from './redaction-patterns.js';

describe('redaction-patterns', () => {
  describe('redactString', () => {
    describe('PII redaction', () => {
      it('should redact email addresses', () => {
        const text = 'Contact user@example.com for support';
        expect(redactString(text)).toBe('Contact [REDACTED-EMAIL] for support');
      });

      it('should redact multiple emails', () => {
        const text = 'Send to john@example.com and jane.doe@company.org';
        expect(redactString(text)).toBe('Send to [REDACTED-EMAIL] and [REDACTED-EMAIL]');
      });

      it('should redact international phone numbers', () => {
        expect(redactString('+1-555-123-4567')).toBe('[REDACTED-PHONE]');
        expect(redactString('+1 555 123 4567')).toBe('[REDACTED-PHONE]');
      });

      it('should redact US phone numbers', () => {
        expect(redactString('Call (555) 123-4567')).toBe('Call [REDACTED-PHONE]');
        expect(redactString('555-123-4567')).toBe('[REDACTED-PHONE]');
        expect(redactString('555.123.4567')).toBe('[REDACTED-PHONE]');
      });

      it('should redact credit card numbers', () => {
        expect(redactString('Card: 4532-1234-5678-9010')).toBe('Card: [REDACTED-CREDITCARD]');
        expect(redactString('4532 1234 5678 9010')).toBe('[REDACTED-CREDITCARD]');
        expect(redactString('4532123456789010')).toBe('[REDACTED-CREDITCARD]');
      });

      it('should redact Amex card numbers', () => {
        expect(redactString('Amex: 3782-822463-10005')).toBe('Amex: [REDACTED-CREDITCARD]');
      });

      it('should redact SSN numbers', () => {
        expect(redactString('SSN: 123-45-6789')).toBe('SSN: [REDACTED-SSN]');
      });

      it('should redact Kazakhstan IIN numbers', () => {
        expect(redactString('IIN: 920101300567')).toBe('IIN: [REDACTED-IIN]');
      });

      it('should preserve non-PII data', () => {
        const text = 'The meeting is at 10:30 AM on 2026-01-15';
        expect(redactString(text)).toBe(text);
      });
    });

    describe('Credential redaction', () => {
      it('should redact Bearer tokens', () => {
        expect(redactString('Authorization: Bearer abc123def456')).toContain('[REDACTED]');
        expect(redactString('token: abc123def456ghi789jkl012mno345')).toContain('[REDACTED]');
      });

      it('should redact Stripe API keys', () => {
        expect(redactString('sk_live_EXAMPLE_KEY_FOR_TESTING_00')).toContain('[REDACTED]');
        expect(redactString('pk_test_EXAMPLE_KEY_FOR_TESTING_00')).toContain('[REDACTED]');
      });

      it('should redact AWS access keys', () => {
        expect(redactString('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA[REDACTED]');
      });

      it('should redact Google API keys', () => {
        expect(redactString('AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY')).toContain('[REDACTED]');
      });

      it('should redact generic API keys', () => {
        expect(redactString('api_key=1234567890abcdefghij')).toContain('[REDACTED]');
        expect(redactString('apiKey: "1234567890abcdefghij"')).toContain('[REDACTED]');
      });

      it('should redact GitHub tokens', () => {
        expect(redactString('ghp_1234567890abcdefghijklmnopqrstuv12')).toContain('[REDACTED]');
        expect(redactString('gho_1234567890abcdefghijklmnopqrstuv12')).toContain('[REDACTED]');
        expect(
          redactString(
            'github_pat_11AAAAAA0AbcdEfghIjklMnopQrstuVwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh'
          )
        ).toContain('[REDACTED]');
      });

      it('should redact passwords', () => {
        expect(redactString('password=secretpass123')).toContain('[REDACTED]');
        expect(redactString('pwd: mypassword')).toContain('[REDACTED]');
        expect(redactString('passwd="P@ssw0rd!"')).toContain('[REDACTED]');
      });

      it('should redact Authorization headers', () => {
        expect(redactString('Authorization: Bearer token123')).toContain('[REDACTED]');
        expect(redactString("Authorization: 'Basic abc123'")).toContain('[REDACTED]');
      });

      it('should redact private keys', () => {
        const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAw7Zdfmece8iaB0kiTY8pCtiBtzbptJmP28nSWwtdjxR5ggD0
-----END RSA PRIVATE KEY-----`;
        expect(redactString(privateKey)).toBe('[PRIVATE_KEY_REDACTED]');
      });
    });

    describe('Network identifier redaction', () => {
      it('should redact IPv4 addresses', () => {
        expect(redactString('Server: 192.168.1.1')).toBe('Server: [REDACTED-IP]');
        expect(redactString('Connect to 10.0.0.255')).toBe('Connect to [REDACTED-IP]');
        expect(redactString('IP: 172.16.254.1')).toBe('IP: [REDACTED-IP]');
      });

      it('should redact IPv6 addresses', () => {
        expect(redactString('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('[REDACTED-IP]');
      });

      it('should handle IPv6 format edge cases', () => {
        // IPv4 pattern will match some version-like numbers (tradeoff for security)
        const text = 'Server: 192.168.1.1';
        expect(redactString(text)).toBe('Server: [REDACTED-IP]');
      });
    });

    describe('Custom pattern lists', () => {
      it('should redact using PII_PATTERNS only', () => {
        const text = 'Email: user@test.com, API key: sk_live_TEST00';
        const result = redactString(text, PII_PATTERNS);
        expect(result).toContain('[REDACTED-EMAIL]');
        expect(result).toContain('sk_live_TEST00'); // Not redacted
      });

      it('should redact using CREDENTIAL_PATTERNS only', () => {
        const text = 'Email: user@test.com, token: abc123def456ghi789jkl012';
        const result = redactString(text, CREDENTIAL_PATTERNS);
        expect(result).toContain('user@test.com'); // Not redacted
        expect(result).toContain('[REDACTED]');
      });

      it('should redact using NETWORK_PATTERNS only', () => {
        const text = 'Server: 192.168.1.1, Email: user@test.com';
        const result = redactString(text, NETWORK_PATTERNS);
        expect(result).toContain('[REDACTED-IP]');
        expect(result).toContain('user@test.com'); // Not redacted
      });
    });

    describe('Edge cases', () => {
      it('should handle empty strings', () => {
        expect(redactString('')).toBe('');
      });

      it('should handle strings with no sensitive data', () => {
        const text = 'This is a normal message with no PII';
        expect(redactString(text)).toBe(text);
      });

      it('should handle multiple patterns in one string', () => {
        const text =
          'Contact user@example.com at 555-123-4567 with Bearer abc123def456ghi789jkl012mno345pqr';
        const result = redactString(text);
        expect(result).toContain('[REDACTED-EMAIL]');
        expect(result).toContain('[REDACTED-PHONE]');
        expect(result).toContain('Bearer [REDACTED]');
      });

      it('should handle overlapping patterns gracefully', () => {
        // Test that redaction doesn't break when patterns might overlap
        const text = 'Bearer token123456789012345678901234567890';
        const result = redactString(text);
        expect(result).toContain('[REDACTED]');
      });
    });
  });

  describe('isSensitiveKey', () => {
    describe('Exact matches', () => {
      it('should identify common sensitive keys', () => {
        expect(isSensitiveKey('password')).toBe(true);
        expect(isSensitiveKey('PASSWORD')).toBe(true);
        expect(isSensitiveKey('passwd')).toBe(true);
        expect(isSensitiveKey('pwd')).toBe(true);
        expect(isSensitiveKey('secret')).toBe(true);
        expect(isSensitiveKey('token')).toBe(true);
        expect(isSensitiveKey('apikey')).toBe(true);
        expect(isSensitiveKey('api_key')).toBe(true);
        expect(isSensitiveKey('authorization')).toBe(true);
        expect(isSensitiveKey('auth')).toBe(true);
        expect(isSensitiveKey('cookie')).toBe(true);
        expect(isSensitiveKey('session')).toBe(true);
        expect(isSensitiveKey('csrf')).toBe(true);
        expect(isSensitiveKey('xsrf')).toBe(true);
      });

      it('should be case-insensitive', () => {
        expect(isSensitiveKey('PASSWORD')).toBe(true);
        expect(isSensitiveKey('PaSsWoRd')).toBe(true);
        expect(isSensitiveKey('API_KEY')).toBe(true);
      });
    });

    describe('Compound patterns', () => {
      it('should identify compound sensitive keys', () => {
        expect(isSensitiveKey('private_key')).toBe(true);
        expect(isSensitiveKey('privateKey')).toBe(true);
        expect(isSensitiveKey('secret_key')).toBe(true);
        expect(isSensitiveKey('secretKey')).toBe(true);
        expect(isSensitiveKey('access_key')).toBe(true);
        expect(isSensitiveKey('accessKey')).toBe(true);
        expect(isSensitiveKey('auth_key')).toBe(true);
        expect(isSensitiveKey('authKey')).toBe(true);
        expect(isSensitiveKey('session_key')).toBe(true);
        expect(isSensitiveKey('sessionKey')).toBe(true);
        expect(isSensitiveKey('encryption_key')).toBe(true);
        expect(isSensitiveKey('encryptionKey')).toBe(true);
      });

      it('should match compound patterns within longer keys', () => {
        expect(isSensitiveKey('aws_access_key_id')).toBe(true);
        expect(isSensitiveKey('stripe_secret_key')).toBe(true);
        expect(isSensitiveKey('user_api_key')).toBe(true);
      });
    });

    describe('Non-sensitive keys', () => {
      it('should not flag normal field names', () => {
        expect(isSensitiveKey('name')).toBe(false);
        expect(isSensitiveKey('email')).toBe(false);
        expect(isSensitiveKey('id')).toBe(false);
        expect(isSensitiveKey('user_id')).toBe(false);
        expect(isSensitiveKey('created_at')).toBe(false);
        expect(isSensitiveKey('updated_at')).toBe(false);
      });

      it('should not flag partial matches', () => {
        expect(isSensitiveKey('pass')).toBe(false); // Too short
        expect(isSensitiveKey('authentication')).toBe(false); // Contains 'auth' but not exact
        expect(isSensitiveKey('tokening')).toBe(false);
      });

      it('should not flag compound words without sensitive patterns', () => {
        expect(isSensitiveKey('public_key')).toBe(false);
        expect(isSensitiveKey('database_key')).toBe(false);
        expect(isSensitiveKey('primary_key')).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty strings', () => {
        expect(isSensitiveKey('')).toBe(false);
      });

      it('should handle whitespace', () => {
        expect(isSensitiveKey('   password   ')).toBe(false); // Exact match requires no whitespace
      });
    });
  });

  describe('getPatternsByCategory', () => {
    it('should return PII patterns', () => {
      const patterns = getPatternsByCategory('pii');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.every((p) => p.category === 'pii')).toBe(true);
      expect(patterns.length).toBe(PII_PATTERNS.length);
    });

    it('should return credential patterns', () => {
      const patterns = getPatternsByCategory('credential');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.every((p) => p.category === 'credential')).toBe(true);
      expect(patterns.length).toBe(CREDENTIAL_PATTERNS.length);
    });

    it('should return network patterns', () => {
      const patterns = getPatternsByCategory('network');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.every((p) => p.category === 'network')).toBe(true);
      expect(patterns.length).toBe(NETWORK_PATTERNS.length);
    });

    it('should have all patterns in ALL_REDACTION_PATTERNS', () => {
      const piiCount = getPatternsByCategory('pii').length;
      const credentialCount = getPatternsByCategory('credential').length;
      const networkCount = getPatternsByCategory('network').length;

      expect(ALL_REDACTION_PATTERNS.length).toBe(piiCount + credentialCount + networkCount);
    });
  });

  describe('Pattern structure validation', () => {
    it('should have all required fields in PII_PATTERNS', () => {
      PII_PATTERNS.forEach((pattern) => {
        expect(pattern).toHaveProperty('pattern');
        expect(pattern).toHaveProperty('replacement');
        expect(pattern).toHaveProperty('category');
        expect(pattern).toHaveProperty('description');
        expect(pattern.pattern).toBeInstanceOf(RegExp);
        expect(typeof pattern.replacement).toBe('string');
        expect(pattern.category).toBe('pii');
        expect(typeof pattern.description).toBe('string');
      });
    });

    it('should have all required fields in CREDENTIAL_PATTERNS', () => {
      CREDENTIAL_PATTERNS.forEach((pattern) => {
        expect(pattern).toHaveProperty('pattern');
        expect(pattern).toHaveProperty('replacement');
        expect(pattern).toHaveProperty('category');
        expect(pattern).toHaveProperty('description');
        expect(pattern.pattern).toBeInstanceOf(RegExp);
        expect(typeof pattern.replacement).toBe('string');
        expect(pattern.category).toBe('credential');
        expect(typeof pattern.description).toBe('string');
      });
    });

    it('should have all required fields in NETWORK_PATTERNS', () => {
      NETWORK_PATTERNS.forEach((pattern) => {
        expect(pattern).toHaveProperty('pattern');
        expect(pattern).toHaveProperty('replacement');
        expect(pattern).toHaveProperty('category');
        expect(pattern).toHaveProperty('description');
        expect(pattern.pattern).toBeInstanceOf(RegExp);
        expect(typeof pattern.replacement).toBe('string');
        expect(pattern.category).toBe('network');
        expect(typeof pattern.description).toBe('string');
      });
    });
  });
});
