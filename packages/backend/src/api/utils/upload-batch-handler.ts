import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import type { BugReport } from '../../db/types.js';

// Presigned URL expiration time (1 hour in seconds)
const PRESIGNED_URL_EXPIRATION_SECONDS = 3600;

/**
 * Allowed MIME types for uploads.
 *
 * CRITICAL SECURITY: This allowlist prevents stored XSS attacks by restricting
 * which content types can be uploaded and served from our storage.
 *
 * NEVER add the following dangerous MIME types:
 * - text/html - Executes JavaScript when opened in browser
 * - text/xml, application/xml - XML External Entity (XXE) attacks
 * - image/svg+xml - SVG can contain embedded <script> tags
 * - application/xhtml+xml - XHTML with script execution
 * - application/javascript, text/javascript - Direct script execution
 * - Any MIME type containing 'script' - Prevents script execution variants
 *
 * Adding a new content type requires security review and must be added here first.
 * The validation function will throw an error if uploadParametersMap uses a type
 * not in this allowlist.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png', // Screenshots
  'application/gzip', // Replays (compressed JSON)
]);

type UploadTypes = 'screenshot' | 'replay';

type UploadParameters = {
  fileName: string;
  uploadType: UploadTypes;
  keyColumn: 'screenshot_key' | 'replay_key';
  uploadStatusField: 'upload_status' | 'replay_upload_status';
  contentType: string; // MIME type to enforce in presigned URL signature
};

/**
 * Normalize MIME type to lowercase for case-insensitive comparison.
 *
 * RFC 2045 Section 5.1 states that MIME type/subtype are case-insensitive,
 * but parameters are case-sensitive. This function normalizes the type/subtype
 * portion while preserving parameter case (if any).
 *
 * Examples:
 * - 'Image/Png' → 'image/png'
 * - 'APPLICATION/GZIP' → 'application/gzip'
 * - 'text/html; charset=UTF-8' → 'text/html; charset=UTF-8'
 *
 * This prevents bypassing allowlists via case variations (e.g., 'Image/Png'
 * instead of 'image/png').
 *
 * @param contentType - MIME type to normalize
 * @returns Normalized MIME type with lowercase type/subtype
 */
export function normalizeContentType(contentType: string): string {
  const trimmed = contentType.trim();

  // Split on semicolon to separate type/subtype from parameters
  const parts = trimmed.split(';');
  const typeSubtype = parts[0].trim().toLowerCase();

  // Preserve parameters with original case (e.g., charset=UTF-8)
  // Trim each parameter part and join with consistent '; ' format per RFC 2045
  if (parts.length > 1) {
    const parameters = parts
      .slice(1)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parameters.length > 0) {
      return `${typeSubtype}; ${parameters.join('; ')}`;
    }
  }

  return typeSubtype;
}

/**
 * Validate that a content type is in the allowlist and return normalized value.
 *
 * CRITICAL SECURITY: This function enforces that only safe MIME types can be
 * used for uploads. It prevents developers from accidentally introducing stored
 * XSS vulnerabilities by using dangerous content types like text/html or image/svg+xml.
 *
 * @param contentType - MIME type to validate (will be normalized before checking)
 * @returns Normalized content type (lowercase type/subtype, preserved parameter case)
 * @throws Error if content type is not in allowlist
 *
 * @example
 * validateContentType('image/png');        // Returns 'image/png'
 * validateContentType('Image/PNG');        // Returns 'image/png' (normalized)
 * validateContentType('text/html');        // Throws error
 * validateContentType('image/svg+xml');    // Throws error
 */
export function validateContentType(contentType: string): string {
  const normalized = normalizeContentType(contentType);

  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw new Error(
      `Content type '${normalized}' is not allowed. Only the following MIME types are permitted: ${Array.from(ALLOWED_CONTENT_TYPES).join(', ')}`
    );
  }

  return normalized;
}

/**
 * Upload parameters for each file type.
 *
 * CRITICAL SECURITY: Content-Type values are enforced in S3 presigned URL signatures
 * to prevent stored XSS attacks. The following MIME types must NEVER be used:
 * - text/html - Executes JavaScript when opened in browser
 * - text/xml, application/xml - XML External Entity (XXE) attacks
 * - image/svg+xml - SVG can contain embedded <script> tags (common mistake)
 * - application/xhtml+xml - XHTML with script execution
 * - application/javascript, text/javascript - Direct script execution
 * - application/x-javascript - Legacy JavaScript MIME type
 * - application/ecmascript, text/vbscript - Alternative scripting languages
 * - text/vtt - WebVTT subtitles can contain JavaScript URLs in cue settings
 * - text/cache-manifest - Can hijack application cache
 * - Any MIME type containing 'script' - Prevents script execution variants
 *
 * Current allowed types (see ALLOWED_CONTENT_TYPES constant):
 * - Screenshots: image/png (safe image format)
 * - Replays: application/gzip (compressed JSON data)
 *
 * All content types are validated via validateContentType() which enforces
 * the ALLOWED_CONTENT_TYPES allowlist and normalizes to prevent case-variation
 * bypasses (e.g., 'Image/Png' → 'image/png').
 *
 * Adding a new upload type requires:
 * 1. Security review to ensure MIME type is safe
 * 2. Adding type to ALLOWED_CONTENT_TYPES constant
 * 3. Adding parameters to uploadParametersMap
 */
const uploadParametersMap: Record<UploadTypes, UploadParameters> = {
  screenshot: {
    fileName: 'screenshot.png',
    uploadType: 'screenshot',
    keyColumn: 'screenshot_key',
    uploadStatusField: 'upload_status',
    contentType: 'image/png',
  },
  replay: {
    fileName: 'replay.gz',
    uploadType: 'replay',
    keyColumn: 'replay_key',
    uploadStatusField: 'replay_upload_status',
    contentType: 'application/gzip',
  },
};

/**
 * Generate presigned URL for upload
 *
 * @param key - Storage key
 * @param contentType - MIME type to enforce in signature (will be normalized)
 * @param storage - Storage service instance
 * @returns Upload URL and storage key
 */
async function generatePresignedUrl(
  key: string,
  contentType: string,
  storage: IStorageService
): Promise<{ uploadUrl: string; storageKey: string }> {
  // CRITICAL SECURITY: Validate content type against allowlist and normalize in one step.
  // This prevents stored XSS attacks from dangerous MIME types (e.g., text/html, image/svg+xml).
  // Throws error if content type is not in ALLOWED_CONTENT_TYPES.
  const normalizedContentType = validateContentType(contentType);

  const uploadUrl = await storage.getPresignedUploadUrl(
    key,
    normalizedContentType,
    PRESIGNED_URL_EXPIRATION_SECONDS
  );
  return {
    uploadUrl,
    storageKey: key,
  };
}

/**
 * Prepare presigned URL and update bug report in database
 *
 * Updates database BEFORE generating presigned URL to prevent race condition
 * where URL is sent but DB update fails.
 *
 * @param parameters - Upload parameters (file name, type, columns)
 * @param db - Database client
 * @param storage - Storage service
 * @param bugReport - Bug report to update (mutated in place)
 * @returns Upload URL and storage key
 */
async function preparePresignedUrlAndUpdateBugReport(
  parameters: UploadParameters,
  db: DatabaseClient,
  storage: IStorageService,
  bugReport: BugReport
): Promise<{ uploadUrl: string; storageKey: string }> {
  const key = `${parameters.uploadType}s/${bugReport.project_id}/${bugReport.id}/${parameters.fileName}`;

  // Update database with storage key BEFORE generating presigned URL
  // This prevents race condition where URL is sent but DB update fails
  await db.bugReports.initiateUpload(
    bugReport.id,
    key,
    parameters.keyColumn,
    parameters.uploadStatusField
  );

  const url = await generatePresignedUrl(key, parameters.contentType, storage);

  // Update local object to match database state
  bugReport[parameters.keyColumn] = key;
  bugReport[parameters.uploadStatusField] = 'pending';

  return url;
}

/**
 * Prepare upload URLs for screenshot and/or replay
 *
 * Consolidates duplicate upload logic for screenshot and replay files.
 * Generates presigned URLs and updates bug report in database atomically.
 *
 * @param bugReport - Bug report to prepare uploads for (mutated in place)
 * @param hasScreenshot - Whether to prepare screenshot upload
 * @param hasReplay - Whether to prepare replay upload
 * @param db - Database client
 * @param storage - Storage service
 * @returns Record of upload URLs by type
 *
 * @example
 * const presignedUrls = await prepareUploadUrls(
 *   bugReport,
 *   true,  // hasScreenshot
 *   false, // hasReplay
 *   db,
 *   storage
 * );
 * // Returns: { screenshot: { uploadUrl, storageKey } }
 */
export async function prepareUploadUrls(
  bugReport: BugReport,
  hasScreenshot: boolean,
  hasReplay: boolean,
  db: DatabaseClient,
  storage: IStorageService
): Promise<Record<string, { uploadUrl: string; storageKey: string }>> {
  const presignedUrls: Record<string, { uploadUrl: string; storageKey: string }> = {};

  if (hasScreenshot) {
    presignedUrls['screenshot'] = await preparePresignedUrlAndUpdateBugReport(
      uploadParametersMap['screenshot'],
      db,
      storage,
      bugReport
    );
  }

  if (hasReplay) {
    presignedUrls['replay'] = await preparePresignedUrlAndUpdateBugReport(
      uploadParametersMap['replay'],
      db,
      storage,
      bugReport
    );
  }

  return presignedUrls;
}
