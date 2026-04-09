import { promises as fs } from 'node:fs';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import type {
  LocalConfig,
  UploadResult,
  SignedUrlOptions,
  ListObjectsOptions,
  ListObjectsResult,
  StorageObject,
  MultipartUploadOptions,
} from './types.js';
import { BaseStorageService } from './base-storage-service.js';
import {
  StorageError,
  StorageConnectionError,
  StorageUploadError,
  StorageNotFoundError,
} from './types.js';
import { getLogger } from '../logger.js';

const pipelineAsync = promisify(pipeline);

const logger = getLogger();

export class LocalStorageService extends BaseStorageService {
  private readonly baseDirectory: string;
  private readonly baseUrl: string;
  private initialized = false;

  constructor(config: LocalConfig) {
    super();
    this.baseDirectory = path.resolve(config.baseDirectory);
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash

    logger.info('Local storage service created', {
      baseDirectory: this.baseDirectory,
      baseUrl: this.baseUrl,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('Storage already initialized');
      return;
    }

    try {
      await fs.mkdir(this.baseDirectory, { recursive: true });
      logger.info('Base directory created/verified', { baseDirectory: this.baseDirectory });

      const testFile = path.join(this.baseDirectory, '.health-check');
      await fs.writeFile(testFile, 'OK');
      await fs.unlink(testFile);

      logger.info('Local storage initialized successfully');
    } catch (error) {
      throw new StorageConnectionError(
        `Failed to initialize local storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }

    this.initialized = true;
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    // For GET operations, return simple URL
    // For PUT operations (client uploads), we'll use a token-based approach
    // Note: This is for local dev only. Production should use S3-compatible storage.

    const url = `${this.baseUrl}/${key}`;

    if (options?.responseContentType || options?.responseContentDisposition) {
      const params = new URLSearchParams();
      if (options.responseContentType) {
        params.set('content-type', options.responseContentType);
      }
      if (options.responseContentDisposition) {
        params.set('content-disposition', options.responseContentDisposition);
      }
      return `${url}?${params.toString()}`;
    }

    return url;
  }

  /**
   * Generate a presigned URL for uploading to local storage
   * For local development - production should use S3-compatible storage
   *
   * NOTE: The contentType parameter is required by IStorageService interface but not used
   * in local storage implementation because:
   * 1. Local storage doesn't enforce content types during upload (no signature validation)
   * 2. This is development-only - production uses S3 where contentType IS enforced in signatures
   * 3. Content-type validation happens at API layer via validateContentType() in upload-batch-handler.ts
   *    which enforces ALLOWED_CONTENT_TYPES allowlist before calling this method
   *
   * @param key - Storage key for the file
   * @param contentType - MIME type (unused in local storage, enforced in S3 production)
   * @param expiresIn - URL expiration time in seconds
   * @returns Upload URL with embedded metadata for local upload endpoint
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn?: number
  ): Promise<string> {
    // contentType intentionally unused - local storage doesn't enforce content types
    // See method documentation for security rationale

    // For local storage, we'll return a special URL that includes the storage key
    // The local upload endpoint will parse this and write to the filesystem
    const uploadUrl = `${this.baseUrl}/upload`;
    const params = new URLSearchParams({
      key,
      expires: String(Date.now() + (expiresIn || 3600) * 1000),
    });

    logger.debug('Generated local presigned upload URL', {
      key,
      contentType, // Log for debugging even though not enforced
      expiresIn,
    });

    return `${uploadUrl}?${params.toString()}`;
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.keyToPath(key);

    try {
      await fs.unlink(filePath);
      logger.debug('File deleted', { key, filePath });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        return;
      }
      throw new StorageError(
        `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
        'DELETE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteFolder(prefix: string): Promise<void> {
    // Use base class validation (DRY + consistent security)
    const validatedPrefix = this.validateDeletePrefix(prefix);

    const folderPath = this.keyToPath(validatedPrefix);

    try {
      // Use Node.js built-in recursive deletion
      // Note: force: false means permission errors will be thrown, not silently ignored
      await fs.rm(folderPath, { recursive: true, force: false });
      logger.info('Folder deleted', { prefix, folderPath });
    } catch (error: unknown) {
      const err = error as { code?: string };
      // Only ignore "not found" errors (already deleted)
      if (err.code === 'ENOENT') {
        logger.debug('Folder already deleted or does not exist', { prefix, folderPath });
        return;
      }
      // Rethrow permission/busy errors with context
      throw new StorageError(
        `Failed to delete folder: ${error instanceof Error ? error.message : String(error)}`,
        'DELETE_FOLDER_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete all storage contents. Use with extreme caution!
   * This is typically only used in tests or administrative cleanup.
   * Does not delete the base directory itself, only its contents.
   */
  async clearAllStorage(): Promise<void> {
    logger.warn('Clearing all storage', { baseDirectory: this.baseDirectory });

    try {
      const entries = await fs.readdir(this.baseDirectory, { withFileTypes: true });

      for (const entry of entries) {
        // Skip health check and hidden files
        if (entry.name.startsWith('.')) {
          continue;
        }

        const fullPath = path.join(this.baseDirectory, entry.name);

        try {
          await fs.rm(fullPath, { recursive: true, force: false });
          logger.debug('Deleted storage entry', { name: entry.name });
        } catch (error: unknown) {
          const err = error as { code?: string };
          // Skip if already deleted
          if (err.code === 'ENOENT') {
            continue;
          }
          // Log but continue with other entries
          logger.error('Failed to delete storage entry', {
            name: entry.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('All storage cleared');
    } catch (error) {
      throw new StorageError(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`,
        'CLEAR_STORAGE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async listObjects(options?: ListObjectsOptions): Promise<ListObjectsResult> {
    // Use base class validation for consistency
    const prefix = this.validateListPrefix(options?.prefix);
    const maxKeys = options?.maxKeys ?? 1000;
    const startAfter = options?.continuationToken;

    try {
      // Start search from prefix path to avoid scanning unrelated directories
      const searchPath = this.resolveSearchPath(prefix);

      const objects: StorageObject[] = [];

      // Collect maxKeys + 1 to determine if truncated (early exit optimization)
      await this.listFilesRecursive(searchPath, objects, maxKeys + 1, prefix);

      // Sort only if we have results
      if (objects.length > 1) {
        objects.sort((a, b) => a.key.localeCompare(b.key));
      }

      // Apply continuation token with binary search
      let startIndex = 0;
      if (startAfter && objects.length > 0) {
        startIndex = this.binarySearchAfter(objects, startAfter);
      }

      // Slice once (avoid intermediate arrays)
      const resultsAfterToken = startIndex > 0 ? objects.slice(startIndex) : objects;
      const isTruncated = resultsAfterToken.length > maxKeys;
      const paginatedObjects = resultsAfterToken.slice(0, maxKeys);

      return {
        objects: paginatedObjects,
        isTruncated,
        nextContinuationToken: isTruncated
          ? paginatedObjects[paginatedObjects.length - 1].key
          : undefined,
      };
    } catch (error) {
      throw new StorageError(
        `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
        'LIST_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async getObject(key: string): Promise<Readable> {
    const filePath = this.keyToPath(key);

    try {
      await fs.access(filePath);
      // True streaming - constant memory usage regardless of file size
      return createReadStream(filePath);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        throw new StorageNotFoundError(key);
      }
      throw new StorageError(
        `Failed to get file: ${error instanceof Error ? error.message : String(error)}`,
        'GET_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async headObject(key: string): Promise<StorageObject | null> {
    const filePath = this.keyToPath(key);

    try {
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
        return null;
      }

      return {
        key,
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        return null;
      }
      throw new StorageError(
        `Failed to stat file: ${error instanceof Error ? error.message : String(error)}`,
        'HEAD_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async uploadStream(
    key: string,
    stream: Readable,
    options?: MultipartUploadOptions
  ): Promise<UploadResult> {
    const filePath = this.keyToPath(key);
    const contentType = options?.contentType ?? 'application/octet-stream';

    try {
      // Ensure directory exists using helper
      await this.ensureDirectoryExists(filePath);

      // Use Node.js pipeline for true streaming (constant memory usage)
      let uploadedBytes = 0;
      const writeStream = createWriteStream(filePath);

      // Track progress if callback provided
      if (options?.onProgress) {
        stream.on('data', (chunk: Buffer) => {
          uploadedBytes += chunk.length;
          // Note: We don't know total size for streams, so pass uploadedBytes for both
          options.onProgress!(uploadedBytes, uploadedBytes);
        });
      }

      // Stream directly to file without buffering in memory
      await pipelineAsync(stream, writeStream);

      // Get final file size
      const stats = await fs.stat(filePath);
      const size = stats.size;

      logger.debug('Stream uploaded', { key, filePath, size });

      const url = `${this.baseUrl}/${key}`;

      return {
        key,
        url,
        size,
        contentType,
      };
    } catch (error) {
      throw new StorageUploadError(
        `Stream upload failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await fs.access(this.baseDirectory);
      return true;
    } catch {
      return false;
    }
  }

  protected async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    const filePath = this.keyToPath(key);

    try {
      await this.ensureDirectoryExists(filePath);
      await fs.writeFile(filePath, buffer);

      logger.debug('File uploaded', { key, filePath, size: buffer.length });

      const url = `${this.baseUrl}/${key}`;

      return {
        key,
        url,
        size: buffer.length,
        contentType,
      };
    } catch (error) {
      throw new StorageUploadError(
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private keyToPath(key: string): string {
    const fullPath = path.resolve(this.baseDirectory, key);
    const normalizedBase = path.resolve(this.baseDirectory);

    // Critical security check: Block operations on base directory itself
    if (fullPath === normalizedBase) {
      throw new StorageError('Cannot operate on base directory itself', 'INVALID_KEY');
    }

    // Critical security check: Prevent directory traversal attacks
    if (!fullPath.startsWith(normalizedBase + path.sep)) {
      throw new StorageError('Path traversal detected in key', 'INVALID_KEY');
    }

    return fullPath;
  }

  /**
   * Resolve search path from prefix to avoid scanning unrelated directories
   * Example: prefix "screenshots/proj-123/" -> start from that directory
   */
  private resolveSearchPath(prefix: string): string {
    if (!prefix) {
      return this.baseDirectory;
    }

    // Convert prefix to filesystem path
    const prefixParts = prefix.split('/').filter(Boolean);
    if (prefixParts.length === 0) {
      return this.baseDirectory;
    }

    // Start from the deepest directory in the prefix
    const prefixPath = prefixParts.join(path.sep);
    const searchPath = path.join(this.baseDirectory, prefixPath);

    // Validate the path exists and is within base directory
    const normalizedSearch = path.resolve(searchPath);
    const normalizedBase = path.resolve(this.baseDirectory);

    if (!normalizedSearch.startsWith(normalizedBase)) {
      return this.baseDirectory; // Fall back to base if invalid
    }

    return searchPath;
  }

  /**
   * Binary search to find the first index after the continuation token
   * O(log n) vs O(n) linear search
   */
  private binarySearchAfter(sorted: StorageObject[], afterKey: string): number {
    let left = 0;
    let right = sorted.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (sorted[mid].key <= afterKey) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Ensure parent directory exists for a file path
   * @param filePath - Full path to the file
   */
  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async listFilesRecursive(
    dirPath: string,
    results: StorageObject[],
    maxKeys: number,
    prefix?: string
  ): Promise<void> {
    // Early exit: Stop when we have enough results
    if (results.length >= maxKeys) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Check limit on every iteration
        if (results.length >= maxKeys) {
          break;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.listFilesRecursive(fullPath, results, maxKeys, prefix);
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          const relativePath = path.relative(this.baseDirectory, fullPath);
          // Normalize path separators to forward slashes for consistency
          const key = relativePath.split(path.sep).join('/');

          // Filter during traversal (not after)
          if (prefix && !key.startsWith(prefix)) {
            continue;
          }

          results.push({
            key,
            size: stats.size,
            lastModified: stats.mtime,
          });
        }
      }
    } catch (error) {
      logger.warn('Error listing directory', { dirPath, error });
    }
  }
}
