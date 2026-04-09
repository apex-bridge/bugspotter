/**
 * S3 URL Builder
 * Single Responsibility: Build correct URLs for S3 objects
 */

import type { S3Config } from './types.js';

export class S3UrlBuilder {
  private readonly config: S3Config;
  private readonly bucket: string;

  constructor(config: S3Config, bucket: string) {
    this.config = config;
    this.bucket = bucket;
  }

  /**
   * Build public URL for an S3 object
   * Handles both custom endpoints and standard S3 URLs
   */
  buildObjectUrl(key: string): string {
    if (this.config.endpoint) {
      return this.buildCustomEndpointUrl(key);
    }
    return this.buildStandardS3Url(key);
  }

  /**
   * Build URL for custom endpoints (MinIO, R2, etc.)
   */
  private buildCustomEndpointUrl(key: string): string {
    // Remove trailing slash from endpoint if present
    const baseEndpoint = this.config.endpoint!.replace(/\/$/, '');

    if (this.config.forcePathStyle) {
      // Path-style: http://endpoint/bucket/key
      return `${baseEndpoint}/${this.bucket}/${key}`;
    } else {
      // Virtual-hosted style: http://bucket.endpoint/key
      const endpointHost = baseEndpoint.replace(/^https?:\/\//, '');
      const protocol = baseEndpoint.startsWith('https') ? 'https' : 'http';
      return `${protocol}://${this.bucket}.${endpointHost}/${key}`;
    }
  }

  /**
   * Build standard AWS S3 URL (virtual-hosted style)
   */
  private buildStandardS3Url(key: string): string {
    return `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }
}
