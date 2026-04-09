/**
 * Webhook Signature Utilities
 *
 * Provides HMAC-SHA256 signing for outgoing webhooks to allow consumers
 * to verify authenticity of webhook payloads.
 *
 * Security headers added to webhook requests:
 * - X-BugSpotter-Signature: HMAC-SHA256 signature of the payload
 * - X-BugSpotter-Timestamp: Unix timestamp when signature was created
 *
 * Consumers should verify:
 * 1. Timestamp is within acceptable window (e.g., 5 minutes)
 * 2. Signature matches computed HMAC of timestamp + payload
 */

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

// ============================================================================
// CONSTANTS
// ============================================================================

export const SIGNATURE_HEADER = 'X-BugSpotter-Signature';
export const TIMESTAMP_HEADER = 'X-BugSpotter-Timestamp';
export const SIGNATURE_ALGORITHM = 'sha256';
export const SIGNATURE_VERSION = 'v1';

/** Default tolerance for timestamp verification (5 minutes in seconds) */
export const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300;

// ============================================================================
// TYPES
// ============================================================================

export interface WebhookSignatureHeaders {
  [SIGNATURE_HEADER]: string;
  [TIMESTAMP_HEADER]: string;
}

export interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// SIGNING FUNCTIONS
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook payload
 *
 * The signed payload format is: `{timestamp}.{payload}`
 * This prevents replay attacks by binding the signature to a specific timestamp.
 *
 * @param payload - JSON string payload to sign
 * @param secret - Per-project webhook secret
 * @param timestamp - Unix timestamp (seconds)
 * @returns Signature in format `v1={hex-encoded-hmac}`
 */
export function generateSignature(payload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac(SIGNATURE_ALGORITHM, secret);
  hmac.update(signedPayload);
  const signature = hmac.digest('hex');
  return `${SIGNATURE_VERSION}=${signature}`;
}

/**
 * Generate signature headers for a webhook request
 *
 * @param payload - Object or string payload to sign
 * @param secret - Per-project webhook secret
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns Headers object with signature and timestamp
 */
export function createSignatureHeaders(
  payload: unknown,
  secret: string,
  timestamp?: number
): WebhookSignatureHeaders {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = generateSignature(payloadString, secret, ts);

  return {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: String(ts),
  };
}

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Verify webhook signature using timing-safe comparison
 *
 * @param payload - The raw payload string that was signed
 * @param signature - The signature from X-BugSpotter-Signature header
 * @param timestamp - The timestamp from X-BugSpotter-Timestamp header
 * @param secret - The webhook secret
 * @param toleranceSeconds - Max age of timestamp (default: 5 minutes)
 * @returns Verification result with error message if invalid
 */
export function verifySignature(
  payload: string,
  signature: string,
  timestamp: string | number,
  secret: string,
  toleranceSeconds: number = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS
): SignatureVerificationResult {
  // Validate timestamp
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  if (isNaN(ts)) {
    return { valid: false, error: 'Invalid timestamp format' };
  }

  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - ts);
  if (age > toleranceSeconds) {
    return {
      valid: false,
      error: `Timestamp too old or too far in future (age: ${age}s, tolerance: ${toleranceSeconds}s)`,
    };
  }

  // Parse signature version
  const [version, signatureValue] = signature.split('=');
  if (version !== SIGNATURE_VERSION) {
    return { valid: false, error: `Unsupported signature version: ${version}` };
  }

  if (!signatureValue) {
    return { valid: false, error: 'Invalid signature format' };
  }

  // Compute expected signature
  const expectedSignature = generateSignature(payload, secret, ts);
  const [, expectedValue] = expectedSignature.split('=');

  // Timing-safe comparison to prevent timing attacks
  try {
    const signatureBuffer = Buffer.from(signatureValue, 'hex');
    const expectedBuffer = Buffer.from(expectedValue, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: 'Signature mismatch' };
    }

    const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!isValid) {
      return { valid: false, error: 'Signature mismatch' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid signature encoding' };
  }
}

/**
 * Extract and verify signature from request headers
 *
 * @param headers - Request headers object
 * @param payload - Raw request body
 * @param secret - Webhook secret
 * @param toleranceSeconds - Max age of timestamp
 */
export function verifyWebhookRequest(
  headers: Record<string, string | undefined>,
  payload: string,
  secret: string,
  toleranceSeconds?: number
): SignatureVerificationResult {
  const signature = headers[SIGNATURE_HEADER] || headers[SIGNATURE_HEADER.toLowerCase()];
  const timestamp = headers[TIMESTAMP_HEADER] || headers[TIMESTAMP_HEADER.toLowerCase()];

  if (!signature) {
    return { valid: false, error: `Missing ${SIGNATURE_HEADER} header` };
  }

  if (!timestamp) {
    return { valid: false, error: `Missing ${TIMESTAMP_HEADER} header` };
  }

  return verifySignature(payload, signature, timestamp, secret, toleranceSeconds);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a cryptographically secure webhook secret
 * Use this when creating a new webhook configuration
 *
 * @param length - Length of the secret in bytes (default: 32)
 * @returns Hex-encoded secret string
 */
export function generateWebhookSecret(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Check if a secret appears to be properly formatted
 * (hex-encoded, sufficient length)
 */
export function isValidSecretFormat(secret: string): boolean {
  // Minimum 32 characters (16 bytes) for reasonable security
  if (secret.length < 32) {
    return false;
  }
  // Should be hex-encoded
  return /^[a-f0-9]+$/i.test(secret);
}
