/**
 * Storage layer constants
 * Centralized configuration values
 */

// S3 Configuration
export const DEFAULT_EXPIRATION_SECONDS = 3600; // 1 hour (for temporary presigned upload URLs)
export const DEFAULT_SIGNED_URL_EXPIRATION_SECONDS = 6 * 24 * 60 * 60; // 6 days (S3 Signature v4 max is 7 days)
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 1000; // 1 second base delay for exponential backoff
export const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
export const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB
export const S3_MAX_PUT_OBJECT_SIZE = 5 * 1024 * 1024 * 1024; // 5GB S3 PutObject limit
export const MAX_KEYS_PER_REQUEST = 1000;

// Image Processing
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
export const MAX_DIMENSION = 4096; // Max width or height
export const THUMBNAIL_MAX_WIDTH = 200;
export const THUMBNAIL_MAX_HEIGHT = 200;
export const THUMBNAIL_QUALITY = 80;
export const WEBP_QUALITY = 85;
export const JPEG_QUALITY = 90;

// Supported image formats
export const SUPPORTED_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'svg'] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];
