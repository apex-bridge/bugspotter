import type { Readable } from 'node:stream';
import type {
  IStorageService,
  UploadResult,
  SignedUrlOptions,
  ListObjectsOptions,
  ListObjectsResult,
  StorageObject,
  MultipartUploadOptions,
} from './types.js';
import { StorageError } from './types.js';
import { getContentType } from './stream-utils.js';
import {
  sanitizeFilename,
  buildStorageKey,
  sanitizeS3Key,
  validateProjectId,
  validateBugId,
  type StorageType,
} from './path-utils.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

// Dangerous prefixes that resolve to base directory
const DANGEROUS_PREFIXES = new Set(['.', './']);

// Standard filenames for storage operations
const STANDARD_FILENAMES = {
  SCREENSHOT_ORIGINAL: 'original.png',
  SCREENSHOT_THUMBNAIL: 'thumbnail.jpg',
  REPLAY_METADATA: 'metadata.json',
} as const;

// Standard content types
const CONTENT_TYPES = {
  IMAGE_JPEG: 'image/jpeg',
  APPLICATION_JSON: 'application/json',
  APPLICATION_GZIP: 'application/gzip',
} as const;

// JSON serialization settings
const JSON_INDENT_SPACES = 2;

export abstract class BaseStorageService implements IStorageService {
  /**
   * Serialize object to JSON buffer with consistent formatting
   * @param data - Object to serialize
   * @returns Buffer containing formatted JSON
   * @protected
   */
  protected serializeToJsonBuffer(data: Record<string, unknown>): Buffer {
    return Buffer.from(JSON.stringify(data, null, JSON_INDENT_SPACES));
  }

  /**
   * Validate chunk index for replay operations
   * @param chunkIndex - Index to validate
   * @throws {StorageError} If chunk index is invalid
   * @protected
   */
  protected validateChunkIndex(chunkIndex: number): void {
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new StorageError('Invalid chunk index', 'INVALID_CHUNK_INDEX');
    }
  }

  protected async uploadWithKey(
    resourceType: StorageType,
    projectId: string,
    bugId: string,
    filename: string,
    buffer: Buffer,
    contentType?: string
  ): Promise<UploadResult> {
    // Validate inputs (common across all implementations)
    const validatedProjectId = validateProjectId(projectId);
    const validatedBugId = validateBugId(bugId);

    // Build and sanitize storage key
    const key = sanitizeS3Key(
      buildStorageKey(resourceType, validatedProjectId, validatedBugId, filename)
    );

    // Determine content type
    const resolvedContentType = contentType ?? getContentType(buffer);

    // Delegate to concrete implementation
    return await this.uploadBuffer(key, buffer, resolvedContentType);
  }

  /**
   * Upload a screenshot (original)
   */
  async uploadScreenshot(projectId: string, bugId: string, buffer: Buffer): Promise<UploadResult> {
    return this.uploadWithKey(
      'screenshots',
      projectId,
      bugId,
      STANDARD_FILENAMES.SCREENSHOT_ORIGINAL,
      buffer
    );
  }

  /**
   * Upload a screenshot thumbnail
   */
  async uploadThumbnail(projectId: string, bugId: string, buffer: Buffer): Promise<UploadResult> {
    return this.uploadWithKey(
      'screenshots',
      projectId,
      bugId,
      STANDARD_FILENAMES.SCREENSHOT_THUMBNAIL,
      buffer,
      CONTENT_TYPES.IMAGE_JPEG
    );
  }

  /**
   * Upload an attachment file
   */
  async uploadAttachment(
    projectId: string,
    bugId: string,
    filename: string,
    buffer: Buffer
  ): Promise<UploadResult> {
    const originalFilename = filename;
    const sanitizedFilename = sanitizeFilename(filename);

    // Log if sanitization changed the filename
    if (sanitizedFilename !== originalFilename) {
      this.logFilenameSanitization(projectId, bugId, originalFilename, sanitizedFilename);
    }

    return this.uploadWithKey('attachments', projectId, bugId, sanitizedFilename, buffer);
  }

  /**
   * Hook method for logging filename sanitization
   * Logs only that sanitization occurred to avoid exposing sensitive filename data
   * Can be overridden by subclasses if needed
   * @protected
   */
  protected logFilenameSanitization(
    projectId: string,
    bugId: string,
    original: string,
    sanitized: string
  ): void {
    logger.info('Attachment filename sanitized', {
      projectId,
      bugId,
      changed: true,
      originalLength: original.length,
      sanitizedLength: sanitized.length,
    });
  }

  /**
   * Validate prefix for deleteFolder operations
   * Prevents deletion of entire storage with dangerous prefixes
   *
   * Security checks:
   * - Blocks empty strings and whitespace-only
   * - Blocks '.' (resolves to base directory)
   * - Blocks './' (also resolves to base directory)
   *
   * @param prefix - Storage prefix to validate
   * @throws {StorageError} If prefix is invalid or dangerous
   * @protected
   */
  protected validateDeletePrefix(prefix: string): string {
    const trimmed = prefix?.trim() || '';

    // Block empty and dangerous prefixes (., ./)
    if (!trimmed || DANGEROUS_PREFIXES.has(trimmed)) {
      throw new StorageError(
        'deleteFolder requires a valid folder prefix. Use clearAllStorage() to delete everything.',
        'INVALID_PREFIX'
      );
    }

    return trimmed;
  }

  /**
   * Validate optional prefix for listObjects operations
   * Allows empty prefix (lists all objects) but sanitizes dangerous patterns
   *
   * @param prefix - Optional storage prefix
   * @returns Sanitized prefix (empty string if not provided)
   * @protected
   */
  protected validateListPrefix(prefix?: string): string {
    if (!prefix) {
      return '';
    }

    const trimmed = prefix.trim();

    return DANGEROUS_PREFIXES.has(trimmed) ? '' : trimmed;
  }

  /**
   * Abstract method - must be implemented by concrete storage services
   * Handles the actual upload operation specific to the storage backend
   * @protected
   */
  protected abstract uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadResult>;

  // Abstract methods from IStorageService - must be implemented by subclasses
  abstract initialize(): Promise<void>;
  abstract getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  abstract getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn?: number
  ): Promise<string>;
  abstract deleteObject(key: string): Promise<void>;
  abstract deleteFolder(prefix: string): Promise<void>;
  abstract listObjects(options?: ListObjectsOptions): Promise<ListObjectsResult>;
  abstract getObject(key: string): Promise<Readable>;
  abstract headObject(key: string): Promise<StorageObject | null>;
  abstract uploadStream(
    key: string,
    stream: Readable,
    options?: MultipartUploadOptions
  ): Promise<UploadResult>;
  abstract healthCheck(): Promise<boolean>;
  abstract clearAllStorage(): Promise<void>;
}
