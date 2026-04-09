/**
 * Encryption Utilities
 * Provides encryption/decryption for sensitive data like integration credentials
 * Uses AES-256-GCM for authenticated encryption
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Encryption algorithm and constants
 */
const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const SALT_LENGTH = 16;
const SCRYPT_N = 16384; // CPU/memory cost parameter
const SCRYPT_R = 8; // Block size
const SCRYPT_P = 1; // Parallelization

/**
 * Encrypted data format
 */
interface EncryptedData {
  iv: string; // Base64 initialization vector
  authTag: string; // Base64 authentication tag
  salt: string; // Base64 salt for key derivation
  encrypted: string; // Base64 encrypted data
}

/**
 * Credential Encryption Service
 * Encrypts and decrypts sensitive credentials using AES-256-GCM
 *
 * Key derivation: Uses scrypt to derive encryption key from master secret
 * Encryption: AES-256-GCM with per-encryption random IV and salt
 * Output: JSON with {iv, authTag, salt, encrypted} all base64-encoded
 */
export class CredentialEncryption {
  private masterKey: Buffer;

  /**
   * Create encryption service with master key from environment
   * @param masterKeyString - Optional master key (defaults to ENCRYPTION_KEY env var)
   * @throws Error if master key is missing or invalid
   */
  constructor(masterKeyString?: string) {
    const keySource = masterKeyString || process.env.ENCRYPTION_KEY;

    if (!keySource) {
      throw new Error(
        'ENCRYPTION_KEY environment variable is required. Generate with: ' +
          'openssl rand -base64 32'
      );
    }

    // Validate key length (base64 of 32 bytes = 44 characters minimum)
    if (keySource.length < 32) {
      throw new Error(
        'ENCRYPTION_KEY must be at least 32 characters. Generate with: openssl rand -base64 32'
      );
    }

    // Convert to buffer (will be used for key derivation)
    this.masterKey = Buffer.from(keySource, 'utf-8');

    logger.debug('Encryption service initialized', {
      algorithm: ALGORITHM,
      keyLength: KEY_LENGTH,
    });
  }

  /**
   * Derive encryption key from master key using scrypt
   * Uses unique salt per encryption for key diversity
   */
  private deriveKey(salt: Buffer): Buffer {
    return scryptSync(this.masterKey, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
  }

  /**
   * Encrypt plaintext string
   * @param plaintext - String to encrypt (e.g., API token)
   * @returns Base64-encoded JSON string with {iv, authTag, salt, encrypted}
   * @throws Error if encryption fails
   */
  encrypt(plaintext: string): string {
    try {
      // Generate random salt and IV for this encryption
      const salt = randomBytes(SALT_LENGTH);
      const iv = randomBytes(IV_LENGTH);

      // Derive encryption key from master key + salt
      const key = this.deriveKey(salt);

      // Create cipher and encrypt
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);

      // Get authentication tag (GCM mode)
      const authTag = cipher.getAuthTag();

      // Package encrypted data
      const encryptedData: EncryptedData = {
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        salt: salt.toString('base64'),
        encrypted: encrypted.toString('base64'),
      };

      // Return as base64-encoded JSON
      return Buffer.from(JSON.stringify(encryptedData), 'utf-8').toString('base64');
    } catch (error) {
      logger.error('Encryption failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt encrypted string
   * @param encryptedString - Base64-encoded JSON from encrypt()
   * @returns Decrypted plaintext string
   * @throws Error if decryption fails or authentication fails
   */
  decrypt(encryptedString: string): string {
    try {
      // Parse encrypted data from base64 JSON
      const jsonString = Buffer.from(encryptedString, 'base64').toString('utf-8');
      const encryptedData: EncryptedData = JSON.parse(jsonString);

      // Extract components
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const authTag = Buffer.from(encryptedData.authTag, 'base64');
      const salt = Buffer.from(encryptedData.salt, 'base64');
      const encrypted = Buffer.from(encryptedData.encrypted, 'base64');

      // Derive same encryption key using stored salt
      const key = this.deriveKey(salt);

      // Create decipher and set auth tag
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt (will throw if authentication fails)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      return decrypted.toString('utf-8');
    } catch (error) {
      logger.error('Decryption failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to decrypt data - invalid key or corrupted data');
    }
  }

  /**
   * Test encryption/decryption roundtrip
   * Useful for validating master key and encryption setup
   */
  test(): boolean {
    try {
      const testData = 'test-encryption-' + Date.now();
      const encrypted = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted);
      return decrypted === testData;
    } catch (error) {
      logger.error('Encryption test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/**
 * Create encryption service instance
 * Singleton pattern for reusing same service
 */
let encryptionService: CredentialEncryption | null = null;

export function getEncryptionService(): CredentialEncryption {
  if (!encryptionService) {
    encryptionService = new CredentialEncryption();
  }
  return encryptionService;
}

/**
 * Helper to encrypt a value
 */
export function encryptValue(plaintext: string): string {
  return getEncryptionService().encrypt(plaintext);
}

/**
 * Helper to decrypt a value
 */
export function decryptValue(encrypted: string): string {
  return getEncryptionService().decrypt(encrypted);
}
