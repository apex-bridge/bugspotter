/**
 * Token Generator Utility
 * Generates cryptographically secure share tokens for public replay access
 */

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

/**
 * Default token length in bytes (32 bytes = 43 base64url characters)
 * Provides 256 bits of entropy for cryptographically secure tokens
 */
const DEFAULT_TOKEN_LENGTH_BYTES = 32;

/**
 * Minimum acceptable token length to satisfy CHECK constraint in database
 * Must be at least 32 characters after base64url encoding
 */
const MIN_TOKEN_LENGTH_CHARACTERS = 32;

/**
 * Generate a cryptographically secure share token
 *
 * Uses crypto.randomBytes for CSPRNG (Cryptographically Secure Pseudo-Random Number Generator)
 * Encodes as base64url (RFC 4648 §5) - URL-safe without padding
 *
 * Token format: 43 characters of [A-Za-z0-9_-]
 * Entropy: 256 bits (32 bytes)
 * Collision probability: ~1 in 10^77 for 1 trillion tokens
 *
 * @param lengthInBytes - Number of random bytes to generate (default: 32)
 * @returns URL-safe token string (base64url encoded)
 *
 * @example
 * const token = generateShareToken();
 * // => "xK9vZ2mN4jL8pQ3rY7sW1tU5vA6bC8dE9fG0hI1jK2l"
 */
export function generateShareToken(lengthInBytes = DEFAULT_TOKEN_LENGTH_BYTES): string {
  if (lengthInBytes < 24) {
    throw new Error(
      `Token length too short: ${lengthInBytes} bytes. Minimum 24 bytes for adequate security.`
    );
  }

  // Generate cryptographically random bytes
  const buffer = randomBytes(lengthInBytes);

  // Convert to base64url (URL-safe, no padding)
  // Standard base64 uses +/= which need URL encoding
  // base64url uses -_ and omits padding for URL safety
  const token = buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return token;
}

/**
 * Validate a share token format
 *
 * Checks:
 * - Length >= 32 characters (database constraint)
 * - Contains only base64url characters: [A-Za-z0-9_-]
 *
 * Does NOT verify:
 * - Token existence in database
 * - Token expiration
 * - Password protection
 *
 * @param token - The token string to validate
 * @returns true if token format is valid, false otherwise
 *
 * @example
 * isValidShareToken("xK9vZ2mN4jL8pQ3rY7sW1tU5vA6bC8dE9fG0hI1jK2l") // => true
 * isValidShareToken("short") // => false
 * isValidShareToken("invalid@characters!") // => false
 */
export function isValidShareToken(token: string): boolean {
  // Check length constraint
  if (token.length < MIN_TOKEN_LENGTH_CHARACTERS) {
    return false;
  }

  // Check format: only base64url characters allowed
  // base64url alphabet: A-Z, a-z, 0-9, -, _
  const base64urlPattern = /^[A-Za-z0-9_-]+$/;
  return base64urlPattern.test(token);
}

/**
 * Calculate token entropy in bits
 * Useful for security auditing and token strength validation
 *
 * @param lengthInBytes - Number of random bytes used to generate token
 * @returns Entropy in bits
 *
 * @example
 * calculateTokenEntropy(32) // => 256 bits
 * calculateTokenEntropy(16) // => 128 bits (NOT recommended - use 32+)
 */
export function calculateTokenEntropy(lengthInBytes: number): number {
  return lengthInBytes * 8;
}

/**
 * Estimate collision probability for a given number of tokens
 * Uses birthday paradox formula: P(collision) ≈ n² / (2 * 2^bits)
 *
 * @param numberOfTokens - Expected number of tokens in system
 * @param entropyBits - Token entropy in bits (default: 256)
 * @returns Approximate collision probability (0.0 to 1.0)
 *
 * @example
 * estimateCollisionProbability(1_000_000, 256) // => ~2.7e-72 (negligible)
 * estimateCollisionProbability(1_000_000, 128) // => ~1.47e-33 (still safe)
 */
export function estimateCollisionProbability(numberOfTokens: number, entropyBits = 256): number {
  // Birthday paradox approximation
  const n = numberOfTokens;
  const spaceSize = Math.pow(2, entropyBits);

  // P(collision) ≈ n² / (2 * spaceSize)
  return (n * n) / (2 * spaceSize);
}

/**
 * Hash a password using bcrypt
 * Uses 10 rounds for balanced security/performance (takes ~100-300ms)
 *
 * Bcrypt is designed for password hashing:
 * - Slow and computationally expensive (prevents brute-force)
 * - Built-in salt (prevents rainbow table attacks)
 * - Adaptive cost factor (can increase rounds as hardware improves)
 *
 * @param password - Plain text password to hash
 * @param rounds - Number of salt rounds (default: 10, range: 4-31)
 * @returns Promise<string> - Bcrypt hash (60 characters, includes salt)
 *
 * @example
 * const hash = await hashPassword('user-password');
 * // => "$2b$10$N9qo8uLOickgx2ZMRZoMye..."
 */
export async function hashPassword(password: string, rounds = 10): Promise<string> {
  if (!password || password.length === 0) {
    throw new Error('Password cannot be empty');
  }

  if (rounds < 4 || rounds > 31) {
    throw new Error('Bcrypt rounds must be between 4 and 31');
  }

  return await bcrypt.hash(password, rounds);
}

/**
 * Verify a password against a bcrypt hash
 * Uses constant-time comparison to prevent timing attacks
 *
 * @param password - Plain text password to verify
 * @param hash - Bcrypt hash to compare against
 * @returns Promise<boolean> - true if password matches hash
 *
 * @example
 * const isValid = await verifyPassword('user-password', storedHash);
 * if (isValid) {
 *   // Password correct
 * }
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // Invalid hash format or comparison error
    return false;
  }
}
