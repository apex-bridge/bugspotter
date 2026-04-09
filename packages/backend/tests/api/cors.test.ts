/**
 * CORS Utility Tests
 * Tests for wildcard pattern conversion to RegExp for @fastify/cors
 */

import { describe, it, expect } from 'vitest';
import { convertCorsOriginsToRegex } from '../../src/api/utils/cors.js';

/**
 * Helper function to test if a generated pattern matches an origin
 * Mimics @fastify/cors's isRequestOriginAllowed logic
 */
function testOriginMatch(origin: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return origin === pattern;
    } else if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(origin);
    }
    return false;
  });
}

describe('convertCorsOriginsToRegex', () => {
  describe('Exact Match Strings', () => {
    it('should pass through exact match strings unchanged', () => {
      const patterns = convertCorsOriginsToRegex([
        'https://demo.bugspotter.io',
        'http://localhost:3000',
      ]);

      expect(patterns).toEqual(['https://demo.bugspotter.io', 'http://localhost:3000']);
      expect(testOriginMatch('https://demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('http://localhost:3000', patterns)).toBe(true);
    });

    it('should not match origins not in the list', () => {
      const patterns = convertCorsOriginsToRegex(['https://demo.bugspotter.io']);

      expect(testOriginMatch('https://evil.com', patterns)).toBe(false);
    });

    it('should be case-sensitive for exact matches', () => {
      const patterns = convertCorsOriginsToRegex(['https://demo.bugspotter.io']);

      expect(testOriginMatch('https://DEMO.bugspotter.io', patterns)).toBe(false);
    });

    it('should match localhost with port', () => {
      const patterns = convertCorsOriginsToRegex(['http://localhost:5173']);

      expect(testOriginMatch('http://localhost:5173', patterns)).toBe(true);
    });
  });

  describe('Wildcard Pattern Matching', () => {
    it('should match single-level subdomain with wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://kazbank-test4.demo.bugspotter.io', patterns)).toBe(true);
    });

    it('should match multiple subdomains with same wildcard pattern', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://project1.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://project2.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://test-xyz.demo.bugspotter.io', patterns)).toBe(true);
    });

    it('should NOT match nested subdomains (*.demo should not match a.b.demo)', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      // Wildcard [^.]+ means "one or more non-dot characters"
      // So it should NOT match nested subdomains
      expect(testOriginMatch('https://nested.subdomain.demo.bugspotter.io', patterns)).toBe(false);
    });

    it('should not match base domain with subdomain wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://demo.bugspotter.io', patterns)).toBe(false);
    });

    it('should support wildcard in different positions', () => {
      const patterns = convertCorsOriginsToRegex(['https://api.*.bugspotter.io']);
      expect(testOriginMatch('https://api.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://api.prod.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://api.staging.bugspotter.io', patterns)).toBe(true);
    });

    it('should handle multiple wildcards in pattern', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.*.bugspotter.io']);
      expect(testOriginMatch('https://app.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://api.prod.bugspotter.io', patterns)).toBe(true);
    });

    it('should not match when protocol differs', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.bugspotter.io']);
      expect(testOriginMatch('http://demo.bugspotter.io', patterns)).toBe(false);
    });
  });

  describe('Mixed Exact and Wildcard', () => {
    it('should check both exact match and wildcard patterns', () => {
      const patterns = convertCorsOriginsToRegex([
        'https://demo.bugspotter.io',
        'https://demo.admin.bugspotter.io',
        'https://*.demo.bugspotter.io',
        'http://localhost:3000',
      ]);

      // Exact matches
      expect(testOriginMatch('https://demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://demo.admin.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('http://localhost:3000', patterns)).toBe(true);

      // Wildcard matches
      expect(testOriginMatch('https://project1.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://kazbank-test4.demo.bugspotter.io', patterns)).toBe(true);

      // Rejections
      expect(testOriginMatch('https://evil.com', patterns)).toBe(false);
      expect(testOriginMatch('https://bugspotter.io', patterns)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty allowed origins array', () => {
      const patterns = convertCorsOriginsToRegex([]);
      expect(testOriginMatch('https://example.com', patterns)).toBe(false);
    });

    it('should filter out empty strings from input', () => {
      const patterns = convertCorsOriginsToRegex([
        'https://example.com',
        '',
        '  ',
        'https://test.com',
      ]);
      expect(patterns).toHaveLength(2);
      expect(testOriginMatch('https://example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://test.com', patterns)).toBe(true);
    });

    it('should not match origins with control characters in subdomain', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://test\n.demo.bugspotter.io', patterns)).toBe(false);
      expect(testOriginMatch('https://test\t.demo.bugspotter.io', patterns)).toBe(false);
      expect(testOriginMatch('https://test\r.demo.bugspotter.io', patterns)).toBe(false);
    });

    it('should not match origins with Unicode characters in subdomain', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://test🔥.demo.bugspotter.io', patterns)).toBe(false);
      expect(testOriginMatch('https://тест.demo.bugspotter.io', patterns)).toBe(false);
    });

    it('should handle origin with port number', () => {
      const patterns = convertCorsOriginsToRegex(['https://demo.bugspotter.io:*']);
      expect(testOriginMatch('https://demo.bugspotter.io:8080', patterns)).toBe(true);
      expect(testOriginMatch('https://demo.bugspotter.io:3000', patterns)).toBe(true);
    });

    it('should reject non-numeric ports with port wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['http://localhost:*']);
      expect(testOriginMatch('http://localhost:foo', patterns)).toBe(false);
      expect(testOriginMatch('http://localhost:abc123', patterns)).toBe(false);
      expect(testOriginMatch('http://localhost:test', patterns)).toBe(false);
    });

    it('should only match numeric ports with port wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['http://localhost:*']);
      expect(testOriginMatch('http://localhost:8080', patterns)).toBe(true);
      expect(testOriginMatch('http://localhost:3000', patterns)).toBe(true);
      expect(testOriginMatch('http://localhost:65535', patterns)).toBe(true);
    });

    it('should reject wildcard-only pattern (security risk)', () => {
      // Wildcard alone is a security risk - should be explicitly rejected
      expect(() => convertCorsOriginsToRegex(['*'])).toThrow(
        'Wildcard-only CORS pattern (*) is not allowed for security reasons'
      );
    });

    it('should handle special characters in origin', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://test-123.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://app-staging.demo.bugspotter.io', patterns)).toBe(true);
    });

    it('should not match when domain parts differ', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.bugspotter.io']);
      expect(testOriginMatch('https://demo.bugspotter.com', patterns)).toBe(false);
    });

    it('should handle query parameters in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://example.com?test=1']);
      expect(testOriginMatch('https://example.com?test=1', patterns)).toBe(true);
      expect(testOriginMatch('https://example.com?test=2', patterns)).toBe(false);
    });

    it('should handle parentheses in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://api(v2).example.com']);
      expect(testOriginMatch('https://api(v2).example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://apiv2.example.com', patterns)).toBe(false);
    });

    it('should handle plus signs in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://user+tag@example.com']);
      expect(testOriginMatch('https://user+tag@example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://usertag@example.com', patterns)).toBe(false);
    });

    it('should handle dollar signs in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://app$test.example.com']);
      expect(testOriginMatch('https://app$test.example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://apptest.example.com', patterns)).toBe(false);
    });

    it('should handle pipes in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://app|test.example.com']);
      expect(testOriginMatch('https://app|test.example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://apptest.example.com', patterns)).toBe(false);
    });

    it('should handle caret and dollar in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://test^end$.example.com']);
      expect(testOriginMatch('https://test^end$.example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://testend.example.com', patterns)).toBe(false);
    });

    it('should handle braces in origin (exact match)', () => {
      const patterns = convertCorsOriginsToRegex(['https://app{1,2}.example.com']);
      expect(testOriginMatch('https://app{1,2}.example.com', patterns)).toBe(true);
      expect(testOriginMatch('https://app1.example.com', patterns)).toBe(false);
    });
  });

  describe('Security Validations', () => {
    it('should not allow bypassing with URL encoding', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://evil.com%2F%2Fdemo.bugspotter.io', patterns)).toBe(false);
    });

    it('should not allow bypassing with path traversal', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://evil.com/../demo.bugspotter.io', patterns)).toBe(false);
    });

    it('should handle unusual but valid subdomains', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.demo.bugspotter.io']);
      expect(testOriginMatch('https://a.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://123.demo.bugspotter.io', patterns)).toBe(true);
      expect(testOriginMatch('https://test-with-dashes.demo.bugspotter.io', patterns)).toBe(true);
    });
  });

  describe('Combined Wildcards', () => {
    it('should handle subdomain and port wildcards together', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.example.com:*']);
      expect(testOriginMatch('https://app.example.com:3000', patterns)).toBe(true);
      expect(testOriginMatch('https://staging.example.com:8080', patterns)).toBe(true);
    });

    it('should reject when subdomain matches but port is missing with combined wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.example.com:*']);
      expect(testOriginMatch('https://app.example.com', patterns)).toBe(false);
    });

    it('should reject when port matches but subdomain does not with combined wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['https://*.example.com:*']);
      expect(testOriginMatch('https://example.com:3000', patterns)).toBe(false);
    });
  });

  describe('IPv6 Support', () => {
    it('should match IPv6 localhost with exact match', () => {
      const patterns = convertCorsOriginsToRegex(['http://[::1]:8080']);
      expect(testOriginMatch('http://[::1]:8080', patterns)).toBe(true);
    });

    it('should match IPv6 address with port wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['http://[::1]:*']);
      expect(testOriginMatch('http://[::1]:8080', patterns)).toBe(true);
    });

    it('should match IPv6 address with different ports using wildcard', () => {
      const patterns = convertCorsOriginsToRegex(['http://[::1]:*']);
      expect(testOriginMatch('http://[::1]:3000', patterns)).toBe(true);
      expect(testOriginMatch('http://[::1]:8080', patterns)).toBe(true);
      expect(testOriginMatch('http://[::1]:65535', patterns)).toBe(true);
    });

    it('should match full IPv6 address', () => {
      const patterns = convertCorsOriginsToRegex([
        'http://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:8080',
      ]);
      expect(
        testOriginMatch('http://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:8080', patterns)
      ).toBe(true);
    });

    it('should match compressed IPv6 address', () => {
      const patterns = convertCorsOriginsToRegex(['http://[2001:db8::1]:*']);
      expect(testOriginMatch('http://[2001:db8::1]:3000', patterns)).toBe(true);
    });

    it('should not match different IPv6 addresses', () => {
      const patterns = convertCorsOriginsToRegex(['http://[::2]:8080']);
      expect(testOriginMatch('http://[::1]:8080', patterns)).toBe(false);
    });

    it('should handle IPv6 without port using exact match', () => {
      const patterns = convertCorsOriginsToRegex(['http://[::1]']);
      expect(testOriginMatch('http://[::1]', patterns)).toBe(true);
    });

    it('should reject IPv6 with port wildcard when no port provided', () => {
      const patterns = convertCorsOriginsToRegex(['http://[::1]:*']);
      expect(testOriginMatch('http://[::1]', patterns)).toBe(false);
    });
  });
});
