/**
 * CORS Origin Regex Pattern Tests
 * Validates nginx map regex for bugspotter.io domain validation
 * 
 * This test replicates the nginx PCRE pattern:
 * "~^https?://([a-z0-9-]+\.)*bugspotter\.io$"
 * 
 * Run with: node apps/admin/tests/nginx/cors-origin.test.mjs
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

// Replicate nginx PCRE pattern in JavaScript
const CORS_ORIGIN_PATTERN = /^https?:\/\/([a-z0-9-]+\.)*bugspotter\.io$/;

/**
 * Test if origin matches the CORS pattern
 * @param {string} origin - Origin URL to test
 * @returns {boolean} - True if origin is allowed
 */
function matchesCorsPattern(origin) {
  return CORS_ORIGIN_PATTERN.test(origin);
}

describe('CORS Origin Pattern Validation', () => {
  describe('Valid Origins (should match)', () => {
    const validOrigins = [
      // Root domain
      'https://bugspotter.io',
      'http://bugspotter.io',
      
      // Single-level subdomains
      'https://app.bugspotter.io',
      'https://admin.bugspotter.io',
      'https://api.bugspotter.io',
      'https://cdn.bugspotter.io',
      
      // Multi-level subdomains (SaaS tenants)
      'https://acme-corp.saas.bugspotter.io',
      'https://acme-corp.kz.saas.bugspotter.io',
      'https://tenant1.region.app.bugspotter.io',
      'https://customer-xyz.prod.bugspotter.io',
      
      // Edge cases
      'https://a.bugspotter.io', // Single character
      'https://123.bugspotter.io', // Numbers only
      'https://test-123.bugspotter.io', // Hyphens
      'https://very-long-subdomain-name.bugspotter.io',
      'https://a.b.c.d.e.f.bugspotter.io', // Many levels
    ];

    validOrigins.forEach((origin) => {
      it(`should allow: ${origin}`, () => {
        assert.strictEqual(
          matchesCorsPattern(origin),
          true,
          `Expected ${origin} to be allowed`
        );
      });
    });
  });

  describe('Invalid Origins (should NOT match)', () => {
    const invalidOrigins = [
      // Wrong domain
      'https://example.com',
      'https://google.com',
      'https://bugspotter.com', // .com instead of .io
      
      // Subdomain hijacking attempts
      'https://bugspotter.io.evil.com',
      'https://fakebugspotter.io.com',
      
      // Typosquatting
      'https://bugspoter.io', // Missing 't'
      'https://bugspotter.io.fake.com',
      
      // Invalid protocols
      'ftp://app.bugspotter.io',
      'ws://app.bugspotter.io',
      'wss://app.bugspotter.io',
      
      // Path attempts
      'https://bugspotter.io/admin',
      'https://app.bugspotter.io/path',
      
      // Port attempts
      'https://bugspotter.io:3000',
      'https://app.bugspotter.io:8080',
      
      // Invalid characters
      'https://app_test.bugspotter.io', // Underscore
      'https://app.test_.bugspotter.io', // Underscore
      'https://APP.bugspotter.io', // Uppercase
      
      // Trailing/leading dots
      'https://.bugspotter.io',
      'https://app..bugspotter.io',
      'https://app.bugspotter.io.',
      
      // Empty/malformed
      '',
      'https://',
      'bugspotter.io',
      '//bugspotter.io',
    ];

    invalidOrigins.forEach((origin) => {
      it(`should block: ${origin}`, () => {
        assert.strictEqual(
          matchesCorsPattern(origin),
          false,
          `Expected ${origin} to be blocked`
        );
      });
    });
  });

  describe('Security Test Cases', () => {
    it('should block domain with bugspotter.io as subdomain', () => {
      assert.strictEqual(matchesCorsPattern('https://bugspotter.io.evil.com'), false);
    });

    it('should block partial domain matches', () => {
      assert.strictEqual(matchesCorsPattern('https://mybugspotter.io'), false);
      assert.strictEqual(matchesCorsPattern('https://bugspotter.io.fake'), false);
    });

    it('should block origins with query strings', () => {
      assert.strictEqual(matchesCorsPattern('https://bugspotter.io?param=value'), false);
    });

    it('should block origins with fragments', () => {
      assert.strictEqual(matchesCorsPattern('https://bugspotter.io#section'), false);
    });

    it('should block origins with user info', () => {
      assert.strictEqual(matchesCorsPattern('https://user:pass@bugspotter.io'), false);
    });
  });

  describe('Multi-tenant SaaS Test Cases', () => {
    it('should support 2-level tenant subdomains', () => {
      assert.strictEqual(matchesCorsPattern('https://acme.saas.bugspotter.io'), true);
    });

    it('should support 3-level tenant subdomains', () => {
      assert.strictEqual(matchesCorsPattern('https://acme.kz.saas.bugspotter.io'), true);
    });

    it('should support 4-level tenant subdomains', () => {
      assert.strictEqual(matchesCorsPattern('https://team1.acme.kz.saas.bugspotter.io'), true);
    });

    it('should support region-based tenant URLs', () => {
      assert.strictEqual(matchesCorsPattern('https://tenant1.us-east.app.bugspotter.io'), true);
      assert.strictEqual(matchesCorsPattern('https://tenant2.eu-west.app.bugspotter.io'), true);
      assert.strictEqual(matchesCorsPattern('https://tenant3.ap-south.app.bugspotter.io'), true);
    });
  });
});

// Run summary
console.log('\n✅ CORS Origin Pattern Tests');
console.log(`Pattern: ${CORS_ORIGIN_PATTERN}\n`);
console.log('Valid examples:');
console.log('  ✓ https://bugspotter.io');
console.log('  ✓ https://app.bugspotter.io');
console.log('  ✓ https://acme-corp.kz.saas.bugspotter.io\n');
console.log('Blocked examples:');
console.log('  ✗ https://bugspotter.io.evil.com');
console.log('  ✗ https://example.com');
console.log('  ✗ https://bugspotter.com\n');
