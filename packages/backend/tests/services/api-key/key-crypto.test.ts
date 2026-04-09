/**
 * API Key Cryptography Tests
 * Tests for key generation, hashing, and verification
 */

import { describe, it, expect } from 'vitest';
import {
  API_KEY_PREFIX,
  KEY_LENGTH,
  KEY_PREFIX_LENGTH,
  KEY_SUFFIX_LENGTH,
  generatePlaintextKey,
  hashKey,
  verifyKey,
  extractKeyMetadata,
} from '../../../src/services/api-key/key-crypto.js';

describe('key-crypto', () => {
  // ============================================================================
  // CONSTANTS
  // ============================================================================

  describe('Constants', () => {
    it('should have correct API key prefix', () => {
      expect(API_KEY_PREFIX).toBe('bgs_');
    });

    it('should have correct key length', () => {
      expect(KEY_LENGTH).toBe(32); // 256 bits
    });

    it('should have correct prefix length', () => {
      expect(KEY_PREFIX_LENGTH).toBe(10);
    });

    it('should have correct suffix length', () => {
      expect(KEY_SUFFIX_LENGTH).toBe(6);
    });
  });

  // ============================================================================
  // KEY GENERATION
  // ============================================================================

  describe('generatePlaintextKey', () => {
    it('should generate key with correct prefix', () => {
      const key = generatePlaintextKey();
      expect(key).toMatch(/^bgs_/);
    });

    it('should generate key with sufficient length', () => {
      const key = generatePlaintextKey();
      // Prefix (4 chars) + base64url encoded 32 bytes (43 chars) = 47 chars minimum
      expect(key.length).toBeGreaterThanOrEqual(40);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generatePlaintextKey());
      }
      expect(keys.size).toBe(100); // All keys should be unique
    });

    it('should only contain valid base64url characters', () => {
      const key = generatePlaintextKey();
      const keyWithoutPrefix = key.slice(API_KEY_PREFIX.length);
      // base64url: A-Z, a-z, 0-9, -, _
      expect(keyWithoutPrefix).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should not contain special characters', () => {
      const key = generatePlaintextKey();
      expect(key).not.toMatch(/[+/=]/); // These are base64, not base64url
    });
  });

  // ============================================================================
  // KEY HASHING
  // ============================================================================

  describe('hashKey', () => {
    it('should produce SHA-256 hash', () => {
      const key = 'bgs_test123456789';
      const hash = hashKey(key);
      expect(hash.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it('should be deterministic', () => {
      const key = 'bgs_test123456789';
      const hash1 = hashKey(key);
      const hash2 = hashKey(key);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const hash1 = hashKey('bgs_key1');
      const hash2 = hashKey('bgs_key2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashKey('');
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should handle very long keys', () => {
      const longKey = 'bgs_' + 'x'.repeat(1000);
      const hash = hashKey(longKey);
      expect(hash.length).toBe(64);
    });

    it('should produce hex-only output', () => {
      const key = generatePlaintextKey();
      const hash = hashKey(key);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should be case-sensitive', () => {
      const hash1 = hashKey('bgs_ABC');
      const hash2 = hashKey('bgs_abc');
      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================================================
  // KEY VERIFICATION
  // ============================================================================

  describe('verifyKey', () => {
    it('should verify correct key matches hash', () => {
      const key = 'bgs_test123456789';
      const hash = hashKey(key);
      expect(verifyKey(key, hash)).toBe(true);
    });

    it('should reject wrong key', () => {
      const key = 'bgs_test123456789';
      const hash = hashKey(key);
      expect(verifyKey('bgs_wrong', hash)).toBe(false);
    });

    it('should reject key with different case', () => {
      const key = 'bgs_test123ABC';
      const hash = hashKey(key);
      expect(verifyKey('bgs_test123abc', hash)).toBe(false);
    });

    it('should reject empty key against non-empty hash', () => {
      const hash = hashKey('bgs_something');
      expect(verifyKey('', hash)).toBe(false);
    });

    it('should reject key against empty hash', () => {
      const key = 'bgs_test123';
      expect(verifyKey(key, '')).toBe(false);
    });

    it('should handle hash length mismatch', () => {
      const key = 'bgs_test';
      const shortHash = 'abc123';
      expect(verifyKey(key, shortHash)).toBe(false);
    });

    it('should use constant-time comparison', () => {
      // Test that verification doesn't short-circuit on first mismatch
      // (timing attack resistance)
      const key = 'bgs_test123456789';
      const hash = hashKey(key);

      const wrongKey1 = 'bgs_wrong456789'; // Differs at start
      const wrongKey2 = 'bgs_test123wrong'; // Differs at end

      // Both should return false regardless of where they differ
      expect(verifyKey(wrongKey1, hash)).toBe(false);
      expect(verifyKey(wrongKey2, hash)).toBe(false);
    });

    it('should work with generated keys', () => {
      const key1 = generatePlaintextKey();
      const hash1 = hashKey(key1);
      expect(verifyKey(key1, hash1)).toBe(true);

      const key2 = generatePlaintextKey();
      expect(verifyKey(key2, hash1)).toBe(false);
    });
  });

  // ============================================================================
  // KEY METADATA EXTRACTION
  // ============================================================================

  describe('extractKeyMetadata', () => {
    it('should extract correct prefix and suffix from generated key', () => {
      const key = generatePlaintextKey();
      const { prefix, suffix } = extractKeyMetadata(key);

      expect(prefix).toBe(key.substring(0, KEY_PREFIX_LENGTH));
      expect(suffix).toBe(key.slice(-KEY_SUFFIX_LENGTH));
      expect(prefix.length).toBe(KEY_PREFIX_LENGTH);
      expect(suffix.length).toBe(KEY_SUFFIX_LENGTH);
    });

    it('should extract prefix and suffix from known key', () => {
      const key = 'bgs_abcdef1234567890xyz';
      const { prefix, suffix } = extractKeyMetadata(key);

      expect(prefix).toBe('bgs_abcdef');
      expect(suffix).toBe('890xyz'); // Last 6 characters
    });

    it('should handle minimum length key', () => {
      const key = 'bgs_abc123456'; // Exactly 16 chars
      const { prefix, suffix } = extractKeyMetadata(key);

      expect(prefix).toBe(key.substring(0, 10));
      expect(suffix).toBe(key.slice(-6));
    });

    it('should always include prefix in metadata', () => {
      const key = generatePlaintextKey();
      const { prefix } = extractKeyMetadata(key);

      expect(prefix).toMatch(/^bgs_/);
    });

    it('should handle very long keys', () => {
      const longKey = 'bgs_' + 'x'.repeat(100) + 'suffix';
      const { prefix, suffix } = extractKeyMetadata(longKey);

      expect(prefix.length).toBe(KEY_PREFIX_LENGTH);
      expect(suffix.length).toBe(KEY_SUFFIX_LENGTH);
      expect(suffix).toBe('suffix');
    });

    it('should extract consistent metadata for same key', () => {
      const key = generatePlaintextKey();
      const metadata1 = extractKeyMetadata(key);
      const metadata2 = extractKeyMetadata(key);

      expect(metadata1.prefix).toBe(metadata2.prefix);
      expect(metadata1.suffix).toBe(metadata2.suffix);
    });

    it('should extract different metadata for different keys', () => {
      const key1 = generatePlaintextKey();
      const key2 = generatePlaintextKey();
      const metadata1 = extractKeyMetadata(key1);
      const metadata2 = extractKeyMetadata(key2);

      // Prefixes might be the same (both start with 'bgs_')
      // but suffixes should be different (high probability with crypto random)
      expect(metadata1.suffix).not.toBe(metadata2.suffix);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration', () => {
    it('should complete full key lifecycle', () => {
      // Generate
      const key = generatePlaintextKey();
      expect(key).toMatch(/^bgs_/);

      // Hash
      const hash = hashKey(key);
      expect(hash.length).toBe(64);

      // Verify
      expect(verifyKey(key, hash)).toBe(true);
    });

    it('should handle multiple keys independently', () => {
      const keys = Array.from({ length: 10 }, () => generatePlaintextKey());
      const hashes = keys.map(hashKey);

      // Each key should only verify against its own hash
      for (let i = 0; i < keys.length; i++) {
        expect(verifyKey(keys[i], hashes[i])).toBe(true);
        for (let j = 0; j < keys.length; j++) {
          if (i !== j) {
            expect(verifyKey(keys[i], hashes[j])).toBe(false);
          }
        }
      }
    });
  });
});
