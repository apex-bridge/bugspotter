/**
 * S3 Client Configuration Builder
 * Single Responsibility: Build and configure S3Client instances
 */

import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import type { S3Config } from './types.js';
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from './constants.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * AWS SDK Middleware Name Constants
 * WARNING: These rely on AWS SDK internal implementation details.
 * If AWS SDK updates break middleware removal, check SDK release notes
 * and update these constants accordingly.
 */
const AWS_MIDDLEWARE_NAMES = {
  /**
   * Flexible checksums middleware adds x-amz-checksum-* headers to requests.
   * This is standard for AWS S3 but breaks some S3-compatible providers (R2, B2).
   * Must be removed from the middleware stack when disableChecksums=true.
   *
   * @see https://github.com/aws/aws-sdk-js-v3/tree/main/packages/middleware-flexible-checksums
   */
  FLEXIBLE_CHECKSUMS: 'flexibleChecksumsMiddleware',
} as const;

export class S3ClientBuilder {
  /**
   * Build S3Client from configuration
   * Handles credential chain and client settings
   * Optionally removes AWS SDK v3 flexible checksums middleware for providers that don't support it
   */
  static build(config: S3Config): S3Client {
    const clientConfig: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? false,
      maxAttempts: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      requestHandler: {
        requestTimeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      },
      // Disable S3 Express One Zone session auth (optimization for standard S3/B2/R2)
      disableS3ExpressSessionAuth: true,
    };

    // Only set credentials if provided (allows IAM role usage)
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken, // Optional: for STS/assumed roles
      };
    }
    // If no credentials, SDK will use default credential chain:
    // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // 2. Shared credentials file (~/.aws/credentials)
    // 3. IAM role for EC2/ECS/Lambda

    const client = new S3Client(clientConfig);

    // Remove AWS SDK v3 flexible checksums middleware if disabled
    // This prevents x-amz-checksum-* headers from appearing in presigned URLs
    if (config.disableChecksums) {
      this.removeChecksumsMiddleware(client);
      logger.info('Removed AWS SDK v3 flexible checksums middleware', {
        reason: 'S3_DISABLE_CHECKSUMS=true or auto-detected incompatible provider',
      });
    }

    return client;
  }

  /**
   * Remove flexible checksums middleware from S3Client
   * This prevents AWS SDK v3 from automatically adding checksum headers
   * that some S3-compatible providers don't support (e.g., Cloudflare R2, Backblaze B2)
   *
   * WARNING: This method accesses undocumented internal AWS SDK properties:
   * - client.middlewareStack (not in public API)
   * - middleware name 'flexibleChecksumsMiddleware' (internal identifier)
   *
   * Risk: Future AWS SDK updates may break this implementation.
   * If middleware removal fails after an SDK upgrade:
   * 1. Check AWS SDK release notes for breaking changes
   * 2. Update AWS_MIDDLEWARE_NAMES.FLEXIBLE_CHECKSUMS constant
   * 3. Verify middlewareStack API hasn't changed
   *
   * @private
   */
  private static removeChecksumsMiddleware(client: S3Client): void {
    try {
      // Access internal middleware stack (not in public TypeScript types)
      const middlewareStack = (
        client as unknown as { middlewareStack?: { remove: (name: string) => boolean } }
      ).middlewareStack;
      if (!middlewareStack) {
        logger.warn('Unable to access S3Client middleware stack', {
          hint: 'AWS SDK internal API may have changed',
        });
        return;
      }

      // Attempt to remove the flexible checksums middleware
      const removed = middlewareStack.remove(AWS_MIDDLEWARE_NAMES.FLEXIBLE_CHECKSUMS);

      if (removed) {
        logger.debug('Successfully removed flexibleChecksumsMiddleware from S3Client');
      } else {
        logger.warn('flexibleChecksumsMiddleware not found in middleware stack', {
          middlewareName: AWS_MIDDLEWARE_NAMES.FLEXIBLE_CHECKSUMS,
          hint: 'AWS SDK may have changed - verify middleware name in SDK source',
        });
      }
    } catch (error) {
      logger.error('Failed to remove checksums middleware', {
        error: error instanceof Error ? error.message : String(error),
        fallback: 'Checksum headers may still appear in requests',
      });
    }
  }

  /**
   * Check if config has explicit credentials
   */
  static hasCredentials(config: S3Config): boolean {
    return !!(config.accessKeyId && config.secretAccessKey);
  }
}
