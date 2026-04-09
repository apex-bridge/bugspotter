/**
 * Constants for stream operations
 * Centralized configuration values for stream utilities
 */

/**
 * Stream size and buffer limits configuration
 *
 * Controls memory usage and processing behavior for stream operations across
 * the storage layer. These limits prevent memory exhaustion and ensure
 * consistent behavior for file uploads, downloads, and transformations.
 *
 * @example
 * ```typescript
 * import { STREAM_LIMITS } from './stream.constants.js';
 *
 * // Check if buffer exceeds max size
 * if (buffer.length > STREAM_LIMITS.MAX_BUFFER_SIZE) {
 *   throw new Error('Buffer too large');
 * }
 *
 * // Use for multipart uploads
 * const chunks = splitIntoChunks(data, STREAM_LIMITS.DEFAULT_CHUNK_SIZE);
 * ```
 *
 * @property MAX_BUFFER_SIZE - Maximum buffer size (10MB) for streamToBuffer operations.
 *   Prevents OOM when loading entire streams into memory. Used by image processing
 *   and upload operations.
 *
 * @property DEFAULT_CHUNK_SIZE - Default chunk size (5MB) for multipart uploads.
 *   Matches S3 minimum multipart size. Used by uploadStream for large file handling.
 *
 * @property MIN_BUFFER_CHECK - Minimum bytes (2) required for content type detection.
 *   Smallest signature is gzip (2 bytes). Used by getContentType for early validation.
 *
 * @property TEXT_PREVIEW_SIZE - Bytes (100) to read for text format detection.
 *   Sufficient to detect JSON/text/binary formats. Used by content type detection.
 *
 * @readonly
 * @constant
 */
export const STREAM_LIMITS = Object.freeze({
  /** Maximum buffer size for streamToBuffer - 10MB */
  MAX_BUFFER_SIZE: 10 * 1024 * 1024,

  /** Default chunk size for multipart operations - 5MB */
  DEFAULT_CHUNK_SIZE: 5 * 1024 * 1024,

  /** Minimum bytes required for content type detection (gzip is 2 bytes) */
  MIN_BUFFER_CHECK: 2,

  /** Bytes to read for text format detection */
  TEXT_PREVIEW_SIZE: 100,
});

/**
 * File signature definition for MIME type detection
 */
export interface FileSignature {
  /** Byte sequence that identifies the file type */
  readonly signature: number[] | readonly number[];

  /** MIME type associated with this signature */
  readonly mimeType: string;

  /** Optional offset from start of file where signature appears */
  readonly offset?: number;
}

/**
 * Known file signatures for content type detection
 * Ordered by specificity - more specific patterns first
 */
export const FILE_SIGNATURES: readonly FileSignature[] = Object.freeze([
  // Images
  Object.freeze({
    signature: Object.freeze([0xff, 0xd8, 0xff]),
    mimeType: 'image/jpeg',
  }),
  Object.freeze({
    signature: Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mimeType: 'image/png',
  }),
  Object.freeze({
    signature: Object.freeze([0x47, 0x49, 0x46]),
    mimeType: 'image/gif',
  }),
  Object.freeze({
    // WEBP: Check for "RIFF" at start and "WEBP" at offset 8
    signature: Object.freeze([0x52, 0x49, 0x46, 0x46]),
    mimeType: 'image/webp',
  }),

  // Documents
  Object.freeze({
    signature: Object.freeze([0x25, 0x50, 0x44, 0x46]),
    mimeType: 'application/pdf',
  }),

  // Archives
  Object.freeze({
    signature: Object.freeze([0x1f, 0x8b]),
    mimeType: 'application/gzip',
  }),
  Object.freeze({
    signature: Object.freeze([0x50, 0x4b, 0x03, 0x04]),
    mimeType: 'application/zip',
  }),
]);

/**
 * Secondary check for WEBP format
 * WEBP files have "RIFF" followed by size, then "WEBP" at byte 8
 */
export function isWebPFormat(buffer: Buffer): boolean {
  if (buffer.length < 12) {
    return false;
  }

  // Check "RIFF" at start
  const hasRIFF =
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;

  // Check "WEBP" at offset 8
  const hasWEBP =
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

  return hasRIFF && hasWEBP;
}
