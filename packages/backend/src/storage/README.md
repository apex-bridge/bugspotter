# Storage Layer

Unified storage interface for BugSpotter supporting multiple backends: local filesystem (development), S3 (production), MinIO (testing), and Cloudflare R2.

## Quick Start

### Local Storage (Development)

```typescript
import { createStorage } from './storage';

const storage = createStorage({
  backend: 'local',
  local: {
    baseDirectory: './data/uploads',
    baseUrl: 'http://localhost:3000/uploads',
  },
});

await storage.initialize();
```

### S3 Storage (Production)

```typescript
const storage = createStorage({
  backend: 's3',
  s3: {
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: 'bugspotter-prod',
  },
});
```

### From Environment Variables

```bash
# .env file
STORAGE_BACKEND=local
STORAGE_BASE_DIR=./data/uploads
STORAGE_BASE_URL=http://localhost:3000/uploads

# Or for S3:
STORAGE_BACKEND=s3
S3_REGION=us-east-1
S3_BUCKET=bugspotter
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret

# Or for Backblaze B2:
STORAGE_BACKEND=s3
S3_REGION=us-west-002
S3_BUCKET=your-bucket
AWS_ACCESS_KEY_ID=your-b2-key-id
AWS_SECRET_ACCESS_KEY=your-b2-application-key
S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com
# S3_DISABLE_CHECKSUMS is auto-detected as true for B2

# Or for Cloudflare R2:
STORAGE_BACKEND=s3
S3_REGION=auto
S3_BUCKET=your-bucket
AWS_ACCESS_KEY_ID=your-r2-access-key-id
AWS_SECRET_ACCESS_KEY=your-r2-secret-access-key
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
# S3_DISABLE_CHECKSUMS is auto-detected as true for R2
```

```typescript
import { createStorageFromEnv } from './storage';

const storage = createStorageFromEnv();
await storage.initialize();
```

## Storage Structure

```
/screenshots/{project_id}/{bug_id}/
  - original.png       # Original screenshot
  - thumbnail.jpg      # Auto-generated thumbnail (200x200)

/replays/{project_id}/{bug_id}/
  - metadata.json      # Session replay metadata
  - chunks/
    - 1.json.gz        # Compressed replay chunks
    - 2.json.gz

/attachments/{project_id}/{bug_id}/
  - {sanitized-filename}  # User uploads (path traversal protected)
```

## Core Operations

```typescript
// Upload screenshot
await storage.uploadScreenshot(projectId, bugId, imageBuffer);

// Upload thumbnail
await storage.uploadThumbnail(projectId, bugId, thumbnailBuffer);

// Upload replay data
await storage.uploadReplayMetadata(projectId, bugId, metadata);
await storage.uploadReplayChunk(projectId, bugId, chunkIndex, compressedData);

// Upload attachment
await storage.uploadAttachment(projectId, bugId, filename, fileBuffer);

// Retrieve
const stream = await storage.getObject(key);
const metadata = await storage.headObject(key);

// Generate signed URL (S3 only, 1 hour default)
const url = await storage.getSignedUrl(key, { expiresIn: 3600 });

// Delete
await storage.deleteObject(key);
await storage.deleteFolder(prefix);

// List
const result = await storage.listObjects({ prefix, maxKeys: 100 });
```

## Architecture

### Template Method Pattern

`BaseStorageService` handles common validation/sanitization logic:

```typescript
abstract class BaseStorageService {
  // Template method with validation
  protected async uploadWithKey(type, projectId, bugId, filename, buffer) {
    // 1. Validate project ID and bug ID (UUID format)
    // 2. Build and sanitize storage key (path traversal prevention)
    // 3. Determine content type
    // 4. Delegate to implementation
    return await this.uploadBuffer(key, buffer, contentType);
  }

  // Hook for subclasses
  protected abstract uploadBuffer(key, buffer, contentType): Promise<UploadResult>;
}
```

### Implementations

- **StorageService** (S3) - True streaming with multipart uploads, retry logic
- **LocalStorageService** - Filesystem operations with directory creation
- Both extend `BaseStorageService` to eliminate code duplication (~200 lines saved)

## Security

- **Path Traversal**: Automatic sanitization of filenames and keys
- **Validation**: Project/bug IDs validated as UUIDs
- **Size Limits**: 5GB max for S3, configurable for local
- **Content Type Detection**: Automatic based on file extension
- **Metadata Stripping**: Images stripped of EXIF/GPS data

## S3-Compatible Storage Providers

### Backblaze B2 & Cloudflare R2 Compatibility

The storage layer automatically detects and configures compatibility for storage providers that don't support AWS SDK v3's automatic checksum headers:

**Auto-Detection** (no configuration needed):

- Backblaze B2: Detects `backblazeb2.com` in `S3_ENDPOINT`
- Cloudflare R2: Detects `.r2.cloudflarestorage.com` in `S3_ENDPOINT`

When detected, the system automatically excludes these headers from presigned URLs:

- `x-amz-checksum-crc32`
- `x-amz-checksum-crc32c`
- `x-amz-checksum-sha1`
- `x-amz-checksum-sha256`
- `x-amz-sdk-checksum-algorithm`

**Manual Override** (if needed):

```bash
# Force disable checksums (e.g., for other S3-compatible providers)
S3_DISABLE_CHECKSUMS=true

# Force enable checksums (e.g., if B2/R2 adds support in future)
S3_DISABLE_CHECKSUMS=false
```

**Supported Providers**:

- ✅ AWS S3 (checksums enabled by default)
- ✅ Backblaze B2 (checksums auto-disabled)
- ✅ Cloudflare R2 (checksums auto-disabled)
- ✅ MinIO (checksums enabled by default)
- ✅ LocalStack (checksums enabled by default)

## Testing

```bash
# Unit tests (mocked storage)
pnpm vitest run tests/storage.test.ts
pnpm vitest run tests/base-storage.test.ts

# Integration tests (real storage)
pnpm vitest run tests/integration/storage.integration.test.ts

# With MinIO (requires Docker)
TEST_MINIO=true pnpm test:integration
```

**Test Coverage**: 30+ dedicated storage tests across unit and integration suites.

## Stream Utilities

The storage layer provides several stream utilities in `stream-utils.ts`:

### Rate-Limited Streaming

```typescript
import { createRateLimitedStream } from './storage';

// Limit upload bandwidth to 1MB/sec
const rateLimiter = createRateLimitedStream(1024 * 1024); // bytes per second
await pipeline(sourceStream, rateLimiter, destinationStream);
```

**Features**:

- Token bucket algorithm with 1-second windows
- Automatic chunk splitting for data larger than rate limit
- Proper async/await with cancelable timers
- Memory leak prevention with cleanup on destroy
- Race condition protection in destroy() method

**Status**: Exported but not currently used in production. Available for future bandwidth throttling needs.

### Other Utilities

- `streamToBuffer(stream, maxSize)` - Convert stream to buffer with size protection
- `bufferToStream(buffer)` - Convert buffer to readable stream
- `splitStreamIntoChunks(stream, chunkSize)` - Split for multipart uploads
- `createProgressStream(onProgress)` - Monitor upload/download progress
- `retryStreamOperation(factory, operation)` - Retry with exponential backoff

## Performance

- **Upload Size Limits**: 5GB for S3 PutObject, unlimited with multipart
- **Multipart Threshold**: Automatic for files >5MB
- **Retry Logic**: Exponential backoff (1s, 2s, 4s...)
- **Memory**: Constant ~5MB usage with streaming (no buffering)
- **Rate Limiting**: Available via `createRateLimitedStream()` for bandwidth throttling (not currently used in production)

## See Also

- [Backend README](../../README.md) - Main backend documentation
- [TESTING.md](../../TESTING.md) - Comprehensive testing guide
- [SECURITY.md](../../SECURITY.md) - Security practices
