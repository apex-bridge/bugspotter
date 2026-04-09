/**
 * Shared format detection utilities
 * Core logic for detecting file formats from buffer contents
 *
 * Provides a single source of truth for format detection, eliminating
 * duplication between getContentType and detectImageFormat.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * File format information
 */
export interface FormatInfo {
  /** Format identifier (e.g., 'jpeg', 'png', 'json') */
  format: string;
  /** MIME type (e.g., 'image/jpeg', 'application/json') */
  mimeType: string;
  /** Category: 'image', 'archive', 'document', 'text' */
  category: 'image' | 'archive' | 'document' | 'text';
}

/**
 * File signature pattern for format detection
 * Supports flexible matching: exact bytes, null (skip), or alternatives
 */
interface FormatSignature {
  /** Format identifier */
  format: string;
  /** MIME type */
  mimeType: string;
  /** Category */
  category: FormatInfo['category'];
  /** Minimum buffer size required */
  minBytes: number;
  /** Byte pattern: number (exact), null (skip), or array (alternatives) */
  signature: ReadonlyArray<number | null | readonly number[]>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Known file format signatures
 * Ordered by specificity - more specific patterns checked first
 */
const FORMAT_SIGNATURES: readonly FormatSignature[] = Object.freeze([
  // Images
  Object.freeze({
    format: 'jpeg',
    mimeType: 'image/jpeg',
    category: 'image' as const,
    minBytes: 3,
    signature: Object.freeze([0xff, 0xd8, 0xff]), // FF D8 FF
  }),
  Object.freeze({
    format: 'png',
    mimeType: 'image/png',
    category: 'image' as const,
    minBytes: 8,
    signature: Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // 89 50 4E 47 0D 0A 1A 0A
  }),
  Object.freeze({
    format: 'webp',
    mimeType: 'image/webp',
    category: 'image' as const,
    minBytes: 12,
    // RIFF....WEBP - check positions 0-3 and 8-11, skip 4-7 (file size)
    signature: Object.freeze([
      0x52,
      0x49,
      0x46,
      0x46,
      null,
      null,
      null,
      null,
      0x57,
      0x45,
      0x42,
      0x50,
    ]),
  }),
  Object.freeze({
    format: 'gif',
    mimeType: 'image/gif',
    category: 'image' as const,
    minBytes: 6,
    // GIF87a or GIF89a - position 4 can be 0x37 or 0x39
    signature: Object.freeze([0x47, 0x49, 0x46, 0x38, Object.freeze([0x37, 0x39]), 0x61]),
  }),

  // Archives
  Object.freeze({
    format: 'gzip',
    mimeType: 'application/gzip',
    category: 'archive' as const,
    minBytes: 2,
    signature: Object.freeze([0x1f, 0x8b]),
  }),
  Object.freeze({
    format: 'zip',
    mimeType: 'application/zip',
    category: 'archive' as const,
    minBytes: 4,
    signature: Object.freeze([0x50, 0x4b, 0x03, 0x04]),
  }),

  // Documents
  Object.freeze({
    format: 'pdf',
    mimeType: 'application/pdf',
    category: 'document' as const,
    minBytes: 4,
    signature: Object.freeze([0x25, 0x50, 0x44, 0x46]), // %PDF
  }),
]);

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Check if buffer matches a signature pattern
 * Supports null (skip position) and array (multiple valid values)
 *
 * @param buffer - Buffer to check
 * @param signature - Signature pattern to match
 * @returns True if buffer matches the pattern
 */
function matchesSignature(
  buffer: Buffer,
  signature: ReadonlyArray<number | null | readonly number[]>
): boolean {
  for (let i = 0; i < signature.length; i++) {
    const expected = signature[i];

    // null means skip this position (e.g., WebP variable bytes 4-7)
    if (expected === null) {
      continue;
    }

    // Array means any of these values is valid (e.g., GIF can be 87a or 89a)
    if (Array.isArray(expected)) {
      if (!expected.includes(buffer[i])) {
        return false;
      }
      continue;
    }

    // Single value must match exactly
    if (buffer[i] !== expected) {
      return false;
    }
  }

  return true;
}

/**
 * Detect text-based formats from buffer content
 * Checks for JSON, XML, and SVG formats
 *
 * @param buffer - Buffer to analyze
 * @returns FormatInfo if text format detected, null otherwise
 */
function detectTextFormat(buffer: Buffer): FormatInfo | null {
  if (buffer.length < 5) {
    return null;
  }

  const text = buffer.slice(0, 100).toString('utf8').trim();

  // JSON detection
  if (text.startsWith('{') || text.startsWith('[')) {
    return {
      format: 'json',
      mimeType: 'application/json',
      category: 'text',
    };
  }

  // SVG detection (can be standalone or with XML declaration)
  if (text.startsWith('<svg') || (text.includes('<?xml') && text.includes('svg'))) {
    return {
      format: 'svg',
      mimeType: 'image/svg+xml',
      category: 'image',
    };
  }

  // Generic XML
  if (text.startsWith('<?xml')) {
    return {
      format: 'xml',
      mimeType: 'application/xml',
      category: 'text',
    };
  }

  return null;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Detect file format from buffer contents
 * Uses magic number detection for binary formats and content analysis for text
 *
 * This is the core detection function used by both getContentType and
 * detectImageFormat, following the DRY principle.
 *
 * @param buffer - File buffer to analyze
 * @returns FormatInfo if format detected, null if unknown
 *
 * @example
 * ```typescript
 * const format = detectFormat(buffer);
 * if (format) {
 *   console.log(format.format);    // 'jpeg'
 *   console.log(format.mimeType);  // 'image/jpeg'
 *   console.log(format.category);  // 'image'
 * }
 * ```
 */
export function detectFormat(buffer: Buffer): FormatInfo | null {
  if (!buffer || buffer.length === 0) {
    return null;
  }

  // Check binary formats using magic numbers
  for (const sig of FORMAT_SIGNATURES) {
    if (buffer.length >= sig.minBytes && matchesSignature(buffer, sig.signature)) {
      return {
        format: sig.format,
        mimeType: sig.mimeType,
        category: sig.category,
      };
    }
  }

  // Check text-based formats
  return detectTextFormat(buffer);
}

/**
 * Check if buffer is a specific format
 * Convenience wrapper around detectFormat
 *
 * @param buffer - Buffer to check
 * @param format - Format to check for (e.g., 'jpeg', 'png')
 * @returns True if buffer matches the specified format
 *
 * @example
 * ```typescript
 * if (isFormat(buffer, 'jpeg')) {
 *   // Process JPEG image
 * }
 * ```
 */
export function isFormat(buffer: Buffer, format: string): boolean {
  const detected = detectFormat(buffer);
  return detected?.format === format;
}

/**
 * Check if buffer is an image format
 * Convenience wrapper for image-specific detection
 *
 * @param buffer - Buffer to check
 * @returns True if buffer is a recognized image format
 *
 * @example
 * ```typescript
 * if (isImageFormat(buffer)) {
 *   // Process image
 * }
 * ```
 */
export function isImageFormat(buffer: Buffer): boolean {
  const detected = detectFormat(buffer);
  return detected?.category === 'image';
}
