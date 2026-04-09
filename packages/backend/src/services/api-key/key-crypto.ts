/**
 * API Key Cryptography
 * Handles key generation, hashing, and verification
 */

import { randomBytes, createHash } from 'crypto';

/**
 * API key prefix for identification
 */
export const API_KEY_PREFIX = 'bgs_';

/**
 * API key length (bytes, not including prefix)
 */
export const KEY_LENGTH = 32; // 256 bits

/**
 * Prefix length for indexing (includes 'bgs_' + first 6 chars)
 */
export const KEY_PREFIX_LENGTH = 10;

/**
 * Suffix length for display (last N characters)
 */
export const KEY_SUFFIX_LENGTH = 6;

/**
 * Generate a cryptographically secure API key
 * @returns Plaintext API key with prefix
 */
export function generatePlaintextKey(): string {
  const randomKey = randomBytes(KEY_LENGTH).toString('base64url');
  return `${API_KEY_PREFIX}${randomKey}`;
}

/**
 * Extract prefix and suffix from plaintext key for indexing
 * @param plaintextKey - Plaintext API key
 * @returns Object with prefix and suffix
 */
export function extractKeyMetadata(plaintextKey: string): { prefix: string; suffix: string } {
  return {
    prefix: plaintextKey.substring(0, KEY_PREFIX_LENGTH),
    suffix: plaintextKey.slice(-KEY_SUFFIX_LENGTH),
  };
}

/**
 * Hash API key using SHA-256
 * @param plaintextKey - Plaintext API key
 * @returns SHA-256 hash of the key
 */
export function hashKey(plaintextKey: string): string {
  return createHash('sha256').update(plaintextKey).digest('hex');
}

/**
 * Verify plaintext key matches hash (constant-time comparison)
 * @param plaintextKey - Plaintext key to verify
 * @param hash - Stored hash to compare against
 * @returns True if key matches hash
 */
export function verifyKey(plaintextKey: string, hash: string): boolean {
  const computedHash = hashKey(plaintextKey);

  // Constant-time comparison to prevent timing attacks
  if (computedHash.length !== hash.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }

  return result === 0;
}
