/**
 * Stream utilities for storage operations
 * Handles buffer/stream conversions and multipart uploads
 */

import { Readable, PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageError } from './types.js';
import { STREAM_LIMITS } from './stream-constants.js';
import { executeWithRetry } from '../utils/retry.js';
import { detectFormat } from './format-detection.js';

/**
 * Generic stream processor with consistent event handling
 * Eliminates duplicate event handler patterns across functions
 *
 * @param stream - Readable stream to process
 * @param onData - Callback invoked for each data chunk
 * @param onComplete - Function called when stream ends, returns final result
 * @returns Promise that resolves with result from onComplete
 * @throws StorageError on stream errors
 */
async function processStream<T>(
  stream: Readable,
  onData: (chunk: Buffer) => void,
  onComplete: () => T
): Promise<T> {
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      try {
        onData(chunk);
      } catch (error) {
        stream.destroy();
        reject(error);
      }
    });

    stream.on('end', () => {
      try {
        resolve(onComplete());
      } catch (error) {
        reject(error);
      }
    });

    stream.on('error', (error) => {
      reject(new StorageError(`Stream error: ${error.message}`, 'STREAM_ERROR', error));
    });
  });
}

/**
 * Convert a Readable stream to a Buffer
 * Useful for small files that need to be fully loaded into memory
 * Refactored to use processStream helper for consistent error handling
 *
 * @param stream - Readable stream to convert
 * @param maxSize - Maximum allowed size in bytes (default: 10MB)
 * @returns Buffer containing stream data
 * @throws StorageError if stream exceeds maxSize
 */
export async function streamToBuffer(
  stream: Readable,
  maxSize: number = STREAM_LIMITS.MAX_BUFFER_SIZE
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  return processStream(
    stream,
    (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        throw new StorageError(
          `Stream exceeds maximum size of ${maxSize} bytes`,
          'STREAM_SIZE_EXCEEDED'
        );
      }
      chunks.push(chunk);
    },
    () => Buffer.concat(chunks)
  );
}

/**
 * Convert a Buffer to a Readable stream
 * @param buffer - Buffer to convert
 * @returns Readable stream
 */
export function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null); // Signal end of stream
  return stream;
}

/**
 * Create a pass-through stream with progress tracking
 * Useful for monitoring upload/download progress
 *
 * @param onProgress - Callback invoked with bytes transferred
 * @returns PassThrough stream
 */
export function createProgressStream(onProgress?: (bytesTransferred: number) => void): PassThrough {
  const passThrough = new PassThrough();
  let bytesTransferred = 0;

  if (onProgress) {
    passThrough.on('data', (chunk: Buffer) => {
      bytesTransferred += chunk.length;
      onProgress(bytesTransferred);
    });
  }

  return passThrough;
}

/**
 * Split a stream into chunks for multipart upload
 * Refactored to use processStream helper for consistent error handling
 *
 * @param stream - Source stream
 * @param chunkSize - Size of each chunk in bytes
 * @returns Array of buffers (chunks)
 */
export async function splitStreamIntoChunks(
  stream: Readable,
  chunkSize: number
): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  let currentChunk: Buffer[] = [];
  let currentSize = 0;

  return processStream(
    stream,
    (data) => {
      currentChunk.push(data);
      currentSize += data.length;

      // If we've accumulated enough data, create a chunk
      while (currentSize >= chunkSize) {
        const chunk = Buffer.concat(currentChunk);
        chunks.push(chunk.slice(0, chunkSize));

        // Keep remainder for next chunk
        const remainder = chunk.slice(chunkSize);
        currentChunk = remainder.length > 0 ? [remainder] : [];
        currentSize = remainder.length;
      }
    },
    () => {
      // Add any remaining data as final chunk
      if (currentChunk.length > 0) {
        chunks.push(Buffer.concat(currentChunk));
      }
      return chunks;
    }
  );
}

/**
 * Calculate stream size without consuming it
 * Uses a pass-through stream to count bytes
 *
 * @param stream - Stream to measure
 * @returns Tuple of [size in bytes, new stream with same data]
 */
export function measureStream(stream: Readable): [Promise<number>, Readable] {
  let size = 0;
  const passThrough = new PassThrough();

  const sizePromise = new Promise<number>((resolve, reject) => {
    passThrough.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });

    passThrough.on('end', () => {
      resolve(size);
    });

    passThrough.on('error', reject);
  });

  // Pipe original stream through pass-through
  stream.pipe(passThrough);

  return [sizePromise, passThrough];
}

/**
 * Retry a stream operation with exponential backoff
 * Creates a new stream for each retry attempt
 * Now uses unified retry utility for consistency
 *
 * @param streamFactory - Function that creates a new stream
 * @param operation - Async operation to perform with the stream
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in ms for exponential backoff (default: 1000)
 * @param shouldRetry - Optional predicate to determine if error should be retried (default: retry all errors)
 * @returns Result of the operation
 */
export async function retryStreamOperation<T>(
  streamFactory: () => Readable,
  operation: (stream: Readable) => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  shouldRetry?: (error: unknown) => boolean
): Promise<T> {
  try {
    return await executeWithRetry(
      async () => {
        const stream = streamFactory();
        return await operation(stream);
      },
      {
        maxAttempts: maxRetries + 1,
        baseDelay,
        shouldRetry, // Use provided predicate or default to retrying all errors
      }
    );
  } catch (error) {
    throw new StorageError(
      `Stream operation failed after ${maxRetries + 1} attempts: ${error instanceof Error ? error.message : String(error)}`,
      'STREAM_OPERATION_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Pipe a stream with error handling and cleanup
 * Ensures proper cleanup even if an error occurs
 *
 * @param source - Source stream
 * @param destination - Destination stream
 * @returns Promise that resolves when piping completes
 */
export async function safePipe(
  source: Readable,
  destination: NodeJS.WritableStream
): Promise<void> {
  try {
    await pipeline(source, destination);
  } catch (error) {
    // Ensure streams are destroyed on error
    if (!source.destroyed) {
      source.destroy();
    }
    throw new StorageError(
      `Stream pipe failed: ${error instanceof Error ? error.message : String(error)}`,
      'STREAM_PIPE_ERROR',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Create a rate-limited stream using Transform stream with proper async handling.
 * Uses a token bucket algorithm to limit throughput.
 * Handles chunks larger than the rate limit by splitting them across multiple windows.
 * Node.js handles backpressure automatically through the transform callback mechanism.
 *
 * @param bytesPerSecond - Maximum bytes per second
 * @returns Transform stream with rate limiting
 */
export function createRateLimitedStream(bytesPerSecond: number): Transform {
  let bytesThisSecond = 0;
  let lastReset = Date.now();
  let pendingTimer: NodeJS.Timeout | null = null;
  let pendingResolve: (() => void) | null = null;

  /**
   * Create error for when stream is destroyed during rate limiting.
   * Indicates incomplete chunk processing due to premature stream termination.
   */
  const createDestroyedError = (): StorageError =>
    new StorageError(
      'Rate-limited stream was destroyed before completing chunk processing',
      'STREAM_DESTROYED_DURING_RATE_LIMIT'
    );

  const stream = new Transform({
    async transform(chunk: Buffer, _encoding, callback) {
      try {
        let offset = 0;

        // Process chunk in pieces if it's larger than the rate limit
        while (offset < chunk.length) {
          const now = Date.now();
          const elapsed = now - lastReset;

          // Reset counter every second
          if (elapsed >= 1000) {
            bytesThisSecond = 0;
            lastReset = now;
          }

          // Calculate how many bytes we can send in this window
          const availableBytes = bytesPerSecond - bytesThisSecond;

          if (availableBytes <= 0) {
            // No capacity left, wait for next window
            const delayMs = Math.max(0, 1000 - elapsed);
            // If already destroyed, bail out early without scheduling a timer
            if (stream.destroyed) {
              callback(createDestroyedError());
              return;
            }

            // Wait for next window. Use a cancelable timer so that if the stream is
            // destroyed while waiting we resolve the promise immediately and avoid
            // leaving a hanging await.
            await new Promise<void>((resolve) => {
              pendingResolve = resolve;
              pendingTimer = setTimeout(() => {
                pendingTimer = null;
                pendingResolve = null;
                resolve();
              }, delayMs);
            });

            // Check if stream was destroyed during await (again) and exit cleanly
            if (stream.destroyed) {
              callback(createDestroyedError());
              return;
            }

            // Reset for new window
            bytesThisSecond = 0;
            lastReset = Date.now();
            continue; // Retry with fresh window
          }

          // Send as much as we can in this window
          const bytesToSend = Math.min(availableBytes, chunk.length - offset);
          const piece = chunk.subarray(offset, offset + bytesToSend);

          bytesThisSecond += bytesToSend;
          offset += bytesToSend;

          // Push the piece - Node.js handles backpressure automatically
          // by not calling our callback until downstream is ready
          this.push(piece);
        }

        // Signal we're done processing this chunk
        // Node.js won't call transform() again until downstream consumes the data
        callback();
      } catch (error) {
        // Clean up any pending timer on error
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        if (pendingResolve) {
          pendingResolve = null;
        }
        callback(error as Error);
      }
    },

    destroy(error: Error | null, callback: (error: Error | null) => void) {
      // Clean up pending timer and resolve any pending Promise so transform
      // doesn't remain awaiting after destroy() is called.
      // CRITICAL: Save resolve reference BEFORE clearing timer to avoid race condition
      // where timer callback could null pendingResolve between clearTimeout and our check.
      const resolveToCall = pendingResolve;

      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }

      // Always null out after clearing timer to prevent timer callback from also calling it
      pendingResolve = null;

      // Call resolve if it existed (safe even if timer callback already fired)
      if (resolveToCall) {
        resolveToCall();
      }

      callback(error);
    },
  });

  return stream;
}

/**
 * Validate stream is readable and not closed
 * @param stream - Stream to validate
 * @throws StorageError if stream is invalid
 */
export function validateStream(stream: Readable): void {
  if (!stream) {
    throw new StorageError('Invalid stream', 'INVALID_STREAM');
  }

  if (stream.destroyed) {
    throw new StorageError('Stream has been destroyed', 'STREAM_DESTROYED');
  }

  if (!stream.readable) {
    throw new StorageError('Stream is not readable', 'STREAM_NOT_READABLE');
  }
}

/**
 * Get content type from buffer by checking magic numbers
 * Uses shared format detection logic for consistency
 *
 * @param buffer - Buffer to check
 * @returns MIME type or 'application/octet-stream' if unknown
 *
 * @example
 * ```typescript
 * const contentType = getContentType(buffer);
 * console.log(contentType); // 'image/jpeg' or 'application/octet-stream'
 * ```
 */
export function getContentType(buffer: Buffer): string {
  if (buffer.length < STREAM_LIMITS.MIN_BUFFER_CHECK) {
    return 'application/octet-stream';
  }

  const format = detectFormat(buffer);
  return format?.mimeType ?? 'application/octet-stream';
}
