/**
 * Token Generator Tests
 * Comprehensive tests for share token generation and validation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateShareToken,
  isValidShareToken,
  calculateTokenEntropy,
  estimateCollisionProbability,
  hashPassword,
  verifyPassword,
} from '../../src/utils/token-generator.js';

describe('Token Generator', () => {
  describe('generateShareToken', () => {
    it('should generate a token with default length (32 bytes)', () => {
      const token = generateShareToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // 32 bytes in base64 = 43 characters (without padding)
      expect(token.length).toBeGreaterThanOrEqual(43);
    });

    it('should generate tokens with only base64url characters', () => {
      const token = generateShareToken();
      const base64urlPattern = /^[A-Za-z0-9_-]+$/;

      expect(base64urlPattern.test(token)).toBe(true);
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');
    });

    it('should generate unique tokens on each call', () => {
      const token1 = generateShareToken();
      const token2 = generateShareToken();
      const token3 = generateShareToken();

      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
    });

    it('should generate tokens of custom length', () => {
      const token24 = generateShareToken(24);
      const token48 = generateShareToken(48);
      const token64 = generateShareToken(64);

      // 24 bytes = 32 chars, 48 bytes = 64 chars, 64 bytes = 85-86 chars
      expect(token24.length).toBeGreaterThanOrEqual(32);
      expect(token48.length).toBeGreaterThanOrEqual(64);
      expect(token64.length).toBeGreaterThanOrEqual(85);
    });

    it('should throw error for token length < 24 bytes', () => {
      expect(() => generateShareToken(23)).toThrow('Token length too short');
      expect(() => generateShareToken(16)).toThrow('Token length too short');
      expect(() => generateShareToken(8)).toThrow('Token length too short');
    });

    it('should accept minimum secure length (24 bytes)', () => {
      expect(() => generateShareToken(24)).not.toThrow();
      const token = generateShareToken(24);
      expect(token.length).toBeGreaterThanOrEqual(32);
    });

    it('should generate tokens that meet database constraint (>= 32 chars)', () => {
      for (let i = 0; i < 10; i++) {
        const token = generateShareToken();
        expect(token.length).toBeGreaterThanOrEqual(32);
      }
    });

    it('should generate URL-safe tokens (no special encoding needed)', () => {
      const token = generateShareToken();

      // Test that token can be used in URL without encoding
      const encodedToken = encodeURIComponent(token);
      expect(encodedToken).toBe(token);
    });

    it('should generate tokens with high entropy', () => {
      const tokens = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        tokens.add(generateShareToken());
      }

      // All tokens should be unique (no collisions)
      expect(tokens.size).toBe(iterations);
    });
  });

  describe('isValidShareToken', () => {
    it('should validate correctly formatted tokens', () => {
      const validToken = generateShareToken();
      expect(isValidShareToken(validToken)).toBe(true);
    });

    it('should accept tokens exactly 32 characters long', () => {
      const token32 = 'A'.repeat(32);
      expect(isValidShareToken(token32)).toBe(true);
    });

    it('should accept tokens longer than 32 characters', () => {
      const token64 = 'A'.repeat(64);
      const token100 = 'B'.repeat(100);

      expect(isValidShareToken(token64)).toBe(true);
      expect(isValidShareToken(token100)).toBe(true);
    });

    it('should reject tokens shorter than 32 characters', () => {
      expect(isValidShareToken('short')).toBe(false);
      expect(isValidShareToken('A'.repeat(31))).toBe(false);
      expect(isValidShareToken('A'.repeat(20))).toBe(false);
      expect(isValidShareToken('')).toBe(false);
    });

    it('should accept all base64url characters', () => {
      const allChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      expect(isValidShareToken(allChars)).toBe(true);
    });

    it('should reject tokens with invalid characters', () => {
      const invalidTokens = [
        'A'.repeat(32) + '+', // Standard base64 character
        'A'.repeat(32) + '/', // Standard base64 character
        'A'.repeat(32) + '=', // Base64 padding
        'A'.repeat(32) + '@', // Special character
        'A'.repeat(32) + ' ', // Space
        'A'.repeat(32) + '!', // Exclamation
        'A'.repeat(32) + '#', // Hash
        'A'.repeat(32) + '$', // Dollar
        'A'.repeat(32) + '%', // Percent
      ];

      invalidTokens.forEach((token) => {
        expect(isValidShareToken(token)).toBe(false);
      });
    });

    it('should reject tokens with unicode characters', () => {
      const unicodeToken = 'A'.repeat(32) + '你好';
      expect(isValidShareToken(unicodeToken)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isValidShareToken('A'.repeat(31))).toBe(false); // Just below minimum
      expect(isValidShareToken('A'.repeat(32))).toBe(true); // Exactly minimum
      expect(isValidShareToken('A'.repeat(33))).toBe(true); // Just above minimum
    });
  });

  describe('calculateTokenEntropy', () => {
    it('should calculate correct entropy for default length (32 bytes)', () => {
      const entropy = calculateTokenEntropy(32);
      expect(entropy).toBe(256); // 32 bytes * 8 bits/byte
    });

    it('should calculate correct entropy for various lengths', () => {
      expect(calculateTokenEntropy(16)).toBe(128);
      expect(calculateTokenEntropy(24)).toBe(192);
      expect(calculateTokenEntropy(32)).toBe(256);
      expect(calculateTokenEntropy(48)).toBe(384);
      expect(calculateTokenEntropy(64)).toBe(512);
    });

    it('should return 0 for 0 bytes', () => {
      expect(calculateTokenEntropy(0)).toBe(0);
    });

    it('should handle large byte counts', () => {
      expect(calculateTokenEntropy(128)).toBe(1024);
      expect(calculateTokenEntropy(256)).toBe(2048);
    });
  });

  describe('estimateCollisionProbability', () => {
    it('should calculate negligible collision probability for 256-bit tokens', () => {
      const prob1M = estimateCollisionProbability(1_000_000, 256);
      const prob1B = estimateCollisionProbability(1_000_000_000, 256);

      // Probability should be extremely low (near 0)
      expect(prob1M).toBeLessThan(1e-60);
      expect(prob1B).toBeLessThan(1e-50);
    });

    it('should calculate higher probability for weaker tokens', () => {
      const prob128 = estimateCollisionProbability(1_000_000, 128);
      const prob64 = estimateCollisionProbability(1_000_000, 64);

      // 128-bit still very low, but higher than 256-bit
      expect(prob128).toBeGreaterThan(0);
      expect(prob128).toBeLessThan(1e-20);

      // 64-bit has measurable collision probability (not recommended)
      expect(prob64).toBeGreaterThan(prob128);
    });

    it('should return 0 for 0 tokens', () => {
      expect(estimateCollisionProbability(0, 256)).toBe(0);
    });

    it('should return 0 for 1 token', () => {
      const prob = estimateCollisionProbability(1, 256);
      // With 1 token, probability should be negligibly small (near 0)
      expect(prob).toBeLessThan(1e-70);
    });

    it('should increase probability with more tokens', () => {
      const prob1K = estimateCollisionProbability(1_000, 256);
      const prob1M = estimateCollisionProbability(1_000_000, 256);
      const prob1B = estimateCollisionProbability(1_000_000_000, 256);

      expect(prob1M).toBeGreaterThan(prob1K);
      expect(prob1B).toBeGreaterThan(prob1M);
    });

    it('should use default entropy of 256 bits', () => {
      const probDefault = estimateCollisionProbability(1_000_000);
      const probExplicit = estimateCollisionProbability(1_000_000, 256);

      expect(probDefault).toBe(probExplicit);
    });
  });

  describe('Security Properties', () => {
    it('should generate cryptographically secure random tokens', () => {
      const tokens = new Set<string>();
      const iterations = 10000;

      // Generate many tokens and check for no patterns or collisions
      for (let i = 0; i < iterations; i++) {
        const token = generateShareToken();

        // No collisions
        expect(tokens.has(token)).toBe(false);
        tokens.add(token);

        // No predictable patterns (first char should vary)
        const firstChars = Array.from(tokens).map((t) => t[0]);
        const uniqueFirstChars = new Set(firstChars);

        // With 10k tokens, we should see good distribution in first character
        if (i > 100) {
          expect(uniqueFirstChars.size).toBeGreaterThan(10);
        }
      }

      expect(tokens.size).toBe(iterations);
    });

    it('should meet database constraint requirements', () => {
      // Generate 100 tokens and verify all meet DB constraint
      for (let i = 0; i < 100; i++) {
        const token = generateShareToken();

        // Length constraint
        expect(token.length).toBeGreaterThanOrEqual(32);

        // Format constraint
        expect(isValidShareToken(token)).toBe(true);

        // Character set constraint (base64url only)
        expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
      }
    });

    it('should demonstrate security margin with birthday paradox', () => {
      // For 1 trillion tokens (way more than we'd ever generate)
      const prob = estimateCollisionProbability(1_000_000_000_000, 256);

      // Probability should still be astronomically low
      expect(prob).toBeLessThan(1e-30);
    });
  });

  describe('Integration with Database Constraints', () => {
    it('should generate tokens that satisfy CHECK constraint', () => {
      // Database has: CONSTRAINT check_token_format CHECK (LENGTH(token) >= 32)
      const token = generateShareToken();

      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(isValidShareToken(token)).toBe(true);
    });

    it('should generate tokens that satisfy UNIQUE constraint', () => {
      // Generate many tokens and ensure uniqueness
      const tokens = [];
      for (let i = 0; i < 1000; i++) {
        tokens.push(generateShareToken());
      }

      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });
  });

  describe('Password Hashing (Bcrypt)', () => {
    it('should hash a password with bcrypt', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      // Bcrypt hash format: $2b$10$... (60 characters)
      expect(hash.length).toBe(60);
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('should generate different hashes for same password (due to salt)', async () => {
      const password = 'same-password';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      const hash3 = await hashPassword(password);

      // Hashes should be different due to random salt
      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);
    });

    it('should verify correct password against hash', async () => {
      const password = 'correct-password';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const correctPassword = 'correct-password';
      const wrongPassword = 'wrong-password';
      const hash = await hashPassword(correctPassword);

      const isValid = await verifyPassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });

    it('should reject empty password for hashing', async () => {
      await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
    });

    it('should reject invalid rounds parameter', async () => {
      await expect(hashPassword('password', 3)).rejects.toThrow(
        'Bcrypt rounds must be between 4 and 31'
      );
      await expect(hashPassword('password', 32)).rejects.toThrow(
        'Bcrypt rounds must be between 4 and 31'
      );
    });

    it('should accept valid rounds range (4-31)', async () => {
      const password = 'test-password';

      // Test minimum rounds
      const hash4 = await hashPassword(password, 4);
      expect(hash4).toMatch(/^\$2b\$04\$/);

      // Test default rounds
      const hash10 = await hashPassword(password, 10);
      expect(hash10).toMatch(/^\$2b\$10\$/);

      // Test maximum rounds (warning: slow!)
      const hash12 = await hashPassword(password, 12);
      expect(hash12).toMatch(/^\$2b\$12\$/);
    });

    it('should return false for empty password in verification', async () => {
      const hash = await hashPassword('password');

      expect(await verifyPassword('', hash)).toBe(false);
      expect(await verifyPassword('password', '')).toBe(false);
    });

    it('should return false for invalid hash format', async () => {
      const password = 'password';
      const invalidHash = 'not-a-valid-bcrypt-hash';

      expect(await verifyPassword(password, invalidHash)).toBe(false);
    });

    it('should be computationally expensive (timing check)', async () => {
      vi.useRealTimers(); // Use real timers for timing measurements
      const password = 'timing-test-password';

      const startTime = Date.now();
      await hashPassword(password, 10);
      const duration = Date.now() - startTime;

      // Bcrypt with 10 rounds should take at least 50ms (usually 100-300ms)
      expect(duration).toBeGreaterThan(50);
    });
  });
});
