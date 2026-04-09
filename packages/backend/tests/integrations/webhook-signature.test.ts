/**
 * Tests for Webhook Signature Utilities
 * Verifies HMAC-SHA256 signing and verification for webhook payloads
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateSignature,
  createSignatureHeaders,
  verifySignature,
  verifyWebhookRequest,
  generateWebhookSecret,
  isValidSecretFormat,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  SIGNATURE_VERSION,
  DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
} from '../../src/integrations/webhook/signature.js';

describe('Webhook Signature Utilities', () => {
  const testSecret = 'a'.repeat(64); // 64 char hex string (32 bytes)
  const testPayload = JSON.stringify({ event: 'test', data: { id: '123' } });
  const testTimestamp = 1705680000; // Fixed timestamp for testing

  describe('generateSignature', () => {
    it('should generate a signature in v1={hex} format', () => {
      const signature = generateSignature(testPayload, testSecret, testTimestamp);

      expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    });

    it('should generate consistent signatures for same inputs', () => {
      const sig1 = generateSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateSignature(testPayload, testSecret, testTimestamp);

      expect(sig1).toBe(sig2);
    });

    it('should generate different signatures for different payloads', () => {
      const sig1 = generateSignature('payload1', testSecret, testTimestamp);
      const sig2 = generateSignature('payload2', testSecret, testTimestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const secret1 = 'a'.repeat(64);
      const secret2 = 'b'.repeat(64);
      const sig1 = generateSignature(testPayload, secret1, testTimestamp);
      const sig2 = generateSignature(testPayload, secret2, testTimestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different timestamps', () => {
      const sig1 = generateSignature(testPayload, testSecret, 1000);
      const sig2 = generateSignature(testPayload, testSecret, 2000);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('createSignatureHeaders', () => {
    it('should return headers with signature and timestamp', () => {
      const headers = createSignatureHeaders(testPayload, testSecret, testTimestamp);

      expect(headers).toHaveProperty(SIGNATURE_HEADER);
      expect(headers).toHaveProperty(TIMESTAMP_HEADER);
      expect(headers[SIGNATURE_HEADER]).toMatch(/^v1=[a-f0-9]{64}$/);
      expect(headers[TIMESTAMP_HEADER]).toBe(String(testTimestamp));
    });

    it('should accept object payloads and stringify them', () => {
      const payload = { event: 'test', data: { id: '123' } };
      const headers = createSignatureHeaders(payload, testSecret, testTimestamp);

      expect(headers[SIGNATURE_HEADER]).toMatch(/^v1=[a-f0-9]{64}$/);
    });

    it('should use current timestamp if not provided', () => {
      const now = Math.floor(Date.now() / 1000);
      const headers = createSignatureHeaders(testPayload, testSecret);
      const headerTimestamp = parseInt(headers[TIMESTAMP_HEADER], 10);

      // Should be within 2 seconds of now
      expect(Math.abs(headerTimestamp - now)).toBeLessThanOrEqual(2);
    });
  });

  describe('verifySignature', () => {
    let realDateNow: () => number;

    beforeEach(() => {
      realDateNow = Date.now;
      // Mock Date.now to return a fixed time (testTimestamp in ms)
      Date.now = vi.fn(() => testTimestamp * 1000);
    });

    afterEach(() => {
      Date.now = realDateNow;
    });

    it('should verify a valid signature', () => {
      const signature = generateSignature(testPayload, testSecret, testTimestamp);
      const result = verifySignature(testPayload, signature, testTimestamp, testSecret);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject an invalid signature', () => {
      const result = verifySignature(testPayload, 'v1=invalid', testTimestamp, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject a mismatched signature', () => {
      const wrongSignature = generateSignature('different payload', testSecret, testTimestamp);
      const result = verifySignature(testPayload, wrongSignature, testTimestamp, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Signature mismatch');
    });

    it('should reject timestamps that are too old', () => {
      const oldTimestamp = testTimestamp - DEFAULT_TIMESTAMP_TOLERANCE_SECONDS - 100;
      const signature = generateSignature(testPayload, testSecret, oldTimestamp);
      const result = verifySignature(testPayload, signature, oldTimestamp, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too old');
    });

    it('should reject timestamps that are too far in the future', () => {
      const futureTimestamp = testTimestamp + DEFAULT_TIMESTAMP_TOLERANCE_SECONDS + 100;
      const signature = generateSignature(testPayload, testSecret, futureTimestamp);
      const result = verifySignature(testPayload, signature, futureTimestamp, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too old or too far in future');
    });

    it('should accept timestamps within tolerance', () => {
      const nearTimestamp = testTimestamp - 60; // 1 minute ago
      const signature = generateSignature(testPayload, testSecret, nearTimestamp);
      const result = verifySignature(testPayload, signature, nearTimestamp, testSecret);

      expect(result.valid).toBe(true);
    });

    it('should accept custom tolerance', () => {
      const oldTimestamp = testTimestamp - 1000; // Way outside default tolerance
      const signature = generateSignature(testPayload, testSecret, oldTimestamp);
      const result = verifySignature(testPayload, signature, oldTimestamp, testSecret, 2000);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid timestamp format', () => {
      const signature = generateSignature(testPayload, testSecret, testTimestamp);
      const result = verifySignature(testPayload, signature, 'not-a-number', testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid timestamp format');
    });

    it('should reject unsupported signature version', () => {
      const result = verifySignature(testPayload, 'v2=abc123', testTimestamp, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported signature version');
    });

    it('should reject invalid signature format (no equals sign)', () => {
      const result = verifySignature(testPayload, 'v1abc123', testTimestamp, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported signature version');
    });
  });

  describe('verifyWebhookRequest', () => {
    let realDateNow: () => number;

    beforeEach(() => {
      realDateNow = Date.now;
      Date.now = vi.fn(() => testTimestamp * 1000);
    });

    afterEach(() => {
      Date.now = realDateNow;
    });

    it('should verify valid request headers', () => {
      const signature = generateSignature(testPayload, testSecret, testTimestamp);
      const headers = {
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: String(testTimestamp),
      };

      const result = verifyWebhookRequest(headers, testPayload, testSecret);

      expect(result.valid).toBe(true);
    });

    it('should verify with lowercase header names', () => {
      const signature = generateSignature(testPayload, testSecret, testTimestamp);
      const headers = {
        [SIGNATURE_HEADER.toLowerCase()]: signature,
        [TIMESTAMP_HEADER.toLowerCase()]: String(testTimestamp),
      };

      const result = verifyWebhookRequest(headers, testPayload, testSecret);

      expect(result.valid).toBe(true);
    });

    it('should reject missing signature header', () => {
      const headers = {
        [TIMESTAMP_HEADER]: String(testTimestamp),
      };

      const result = verifyWebhookRequest(headers, testPayload, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(`Missing ${SIGNATURE_HEADER} header`);
    });

    it('should reject missing timestamp header', () => {
      const signature = generateSignature(testPayload, testSecret, testTimestamp);
      const headers = {
        [SIGNATURE_HEADER]: signature,
      };

      const result = verifyWebhookRequest(headers, testPayload, testSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(`Missing ${TIMESTAMP_HEADER} header`);
    });
  });

  describe('generateWebhookSecret', () => {
    it('should generate a hex string of correct length', () => {
      const secret = generateWebhookSecret();

      // 32 bytes = 64 hex characters
      expect(secret).toHaveLength(64);
      expect(secret).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate unique secrets', () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();

      expect(secret1).not.toBe(secret2);
    });

    it('should accept custom length', () => {
      const secret = generateWebhookSecret(16);

      // 16 bytes = 32 hex characters
      expect(secret).toHaveLength(32);
    });
  });

  describe('isValidSecretFormat', () => {
    it('should accept valid hex secrets', () => {
      expect(isValidSecretFormat('a'.repeat(64))).toBe(true);
      expect(isValidSecretFormat('0123456789abcdef'.repeat(4))).toBe(true);
      expect(isValidSecretFormat('ABCDEF0123456789'.repeat(4))).toBe(true);
    });

    it('should reject secrets that are too short', () => {
      expect(isValidSecretFormat('abc123')).toBe(false);
      expect(isValidSecretFormat('a'.repeat(31))).toBe(false);
    });

    it('should reject non-hex characters', () => {
      expect(isValidSecretFormat('g'.repeat(64))).toBe(false);
      expect(isValidSecretFormat('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should export correct header names', () => {
      expect(SIGNATURE_HEADER).toBe('X-BugSpotter-Signature');
      expect(TIMESTAMP_HEADER).toBe('X-BugSpotter-Timestamp');
    });

    it('should export correct signature version', () => {
      expect(SIGNATURE_VERSION).toBe('v1');
    });

    it('should export default tolerance', () => {
      expect(DEFAULT_TIMESTAMP_TOLERANCE_SECONDS).toBe(300); // 5 minutes
    });
  });
});
