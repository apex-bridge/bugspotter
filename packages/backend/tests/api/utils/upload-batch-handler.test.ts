/**
 * Unit tests for upload batch handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prepareUploadUrls,
  normalizeContentType,
  validateContentType,
} from '../../../src/api/utils/upload-batch-handler.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { IStorageService } from '../../../src/storage/types.js';
import type { BugReport } from '../../../src/db/types.js';

describe('prepareUploadUrls', () => {
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;
  let mockBugReport: BugReport;

  beforeEach(() => {
    mockDb = {
      bugReports: {
        initiateUpload: vi.fn(),
      },
    } as unknown as DatabaseClient;

    mockStorage = {
      getPresignedUploadUrl: vi.fn(),
    } as unknown as IStorageService;

    mockBugReport = {
      id: 'bug-123',
      project_id: 'proj-456',
      organization_id: 'org-789',
      title: 'Test Bug',
      description: 'Test description',
      priority: 'high',
      status: 'open',
      metadata: {},
      screenshot_url: null,
      replay_url: null,
      screenshot_key: null,
      replay_key: null,
      upload_status: 'none',
      replay_upload_status: 'none',
      thumbnail_key: null,
      deleted_at: null,
      deleted_by: null,
      legal_hold: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
  });

  describe('Screenshot uploads', () => {
    it('should generate presigned URL for screenshot only', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue(
        'https://storage.example.com/upload/screenshot'
      );

      const result = await prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage);

      expect(result).toEqual({
        screenshot: {
          uploadUrl: 'https://storage.example.com/upload/screenshot',
          storageKey: 'screenshots/proj-456/bug-123/screenshot.png',
        },
      });
      expect(Object.keys(result)).toHaveLength(1);
    });

    it('should update database before generating presigned URL', async () => {
      const initiateUploadSpy = vi.mocked(mockDb.bugReports.initiateUpload);
      const getPresignedUrlSpy = vi.mocked(mockStorage.getPresignedUploadUrl);

      getPresignedUrlSpy.mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage);

      // Database update should be called before URL generation
      expect(initiateUploadSpy).toHaveBeenCalledWith(
        'bug-123',
        'screenshots/proj-456/bug-123/screenshot.png',
        'screenshot_key',
        'upload_status'
      );
      expect(initiateUploadSpy).toHaveBeenCalledBefore(getPresignedUrlSpy);
    });

    it('should mutate bug report object with storage key and status', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage);

      expect(mockBugReport.screenshot_key).toBe('screenshots/proj-456/bug-123/screenshot.png');
      expect(mockBugReport.upload_status).toBe('pending');
    });
  });

  describe('Replay uploads', () => {
    it('should generate presigned URL for replay only', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue(
        'https://storage.example.com/upload/replay'
      );

      const result = await prepareUploadUrls(mockBugReport, false, true, mockDb, mockStorage);

      expect(result).toEqual({
        replay: {
          uploadUrl: 'https://storage.example.com/upload/replay',
          storageKey: 'replays/proj-456/bug-123/replay.gz',
        },
      });
      expect(Object.keys(result)).toHaveLength(1);
    });

    it('should use correct storage key and columns for replay', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, false, true, mockDb, mockStorage);

      expect(mockDb.bugReports.initiateUpload).toHaveBeenCalledWith(
        'bug-123',
        'replays/proj-456/bug-123/replay.gz',
        'replay_key',
        'replay_upload_status'
      );

      expect(mockBugReport.replay_key).toBe('replays/proj-456/bug-123/replay.gz');
      expect(mockBugReport.replay_upload_status).toBe('pending');
    });
  });

  describe('Both screenshot and replay', () => {
    it('should generate presigned URLs for both when requested', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl)
        .mockResolvedValueOnce('https://storage/upload/screenshot')
        .mockResolvedValueOnce('https://storage/upload/replay');

      const result = await prepareUploadUrls(mockBugReport, true, true, mockDb, mockStorage);

      expect(result).toEqual({
        screenshot: {
          uploadUrl: 'https://storage/upload/screenshot',
          storageKey: 'screenshots/proj-456/bug-123/screenshot.png',
        },
        replay: {
          uploadUrl: 'https://storage/upload/replay',
          storageKey: 'replays/proj-456/bug-123/replay.gz',
        },
      });
      expect(Object.keys(result)).toHaveLength(2);
    });

    it('should call initiateUpload twice for both uploads', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, true, mockDb, mockStorage);

      expect(mockDb.bugReports.initiateUpload).toHaveBeenCalledTimes(2);
      expect(mockDb.bugReports.initiateUpload).toHaveBeenNthCalledWith(
        1,
        'bug-123',
        'screenshots/proj-456/bug-123/screenshot.png',
        'screenshot_key',
        'upload_status'
      );
      expect(mockDb.bugReports.initiateUpload).toHaveBeenNthCalledWith(
        2,
        'bug-123',
        'replays/proj-456/bug-123/replay.gz',
        'replay_key',
        'replay_upload_status'
      );
    });

    it('should update both fields in bug report object', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, true, mockDb, mockStorage);

      expect(mockBugReport.screenshot_key).toBe('screenshots/proj-456/bug-123/screenshot.png');
      expect(mockBugReport.upload_status).toBe('pending');
      expect(mockBugReport.replay_key).toBe('replays/proj-456/bug-123/replay.gz');
      expect(mockBugReport.replay_upload_status).toBe('pending');
    });
  });

  describe('No uploads requested', () => {
    it('should return empty object when no uploads requested', async () => {
      const result = await prepareUploadUrls(mockBugReport, false, false, mockDb, mockStorage);

      expect(result).toEqual({});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should not call database or storage when no uploads', async () => {
      await prepareUploadUrls(mockBugReport, false, false, mockDb, mockStorage);

      expect(mockDb.bugReports.initiateUpload).not.toHaveBeenCalled();
      expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('should not mutate bug report object when no uploads', async () => {
      const originalScreenshotKey = mockBugReport.screenshot_key;
      const originalReplayKey = mockBugReport.replay_key;

      await prepareUploadUrls(mockBugReport, false, false, mockDb, mockStorage);

      expect(mockBugReport.screenshot_key).toBe(originalScreenshotKey);
      expect(mockBugReport.replay_key).toBe(originalReplayKey);
    });
  });

  describe('Error handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      vi.mocked(mockDb.bugReports.initiateUpload).mockRejectedValue(dbError);

      await expect(
        prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage)
      ).rejects.toThrow('Database connection failed');
    });

    it('should propagate storage errors', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockRejectedValue(
        new Error('S3 service unavailable')
      );

      await expect(
        prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage)
      ).rejects.toThrow('S3 service unavailable');
    });

    it('should fail fast on first error when both uploads requested', async () => {
      vi.mocked(mockDb.bugReports.initiateUpload)
        .mockResolvedValueOnce(1) // Screenshot succeeds
        .mockRejectedValueOnce(new Error('Replay upload failed')); // Replay fails

      await expect(
        prepareUploadUrls(mockBugReport, true, true, mockDb, mockStorage)
      ).rejects.toThrow('Replay upload failed');

      // Should have attempted both, but second one failed
      expect(mockDb.bugReports.initiateUpload).toHaveBeenCalledTimes(2);
    });
  });

  describe('Storage key format', () => {
    it('should use correct path format for screenshot', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage);

      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        'screenshots/proj-456/bug-123/screenshot.png',
        'image/png',
        3600
      );
    });

    it('should use correct path format for replay', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, false, true, mockDb, mockStorage);

      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        'replays/proj-456/bug-123/replay.gz',
        'application/gzip',
        3600
      );
    });

    it('should include project_id and bug_id in storage keys', async () => {
      const customBugReport: BugReport = {
        ...mockBugReport,
        id: 'custom-bug-999',
        project_id: 'custom-proj-888',
      };

      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(customBugReport, true, true, mockDb, mockStorage);

      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        'screenshots/custom-proj-888/custom-bug-999/screenshot.png',
        'image/png',
        3600
      );
      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        'replays/custom-proj-888/custom-bug-999/replay.gz',
        'application/gzip',
        3600
      );
    });
  });

  describe('Presigned URL expiry', () => {
    it('should use 1 hour (3600 seconds) expiry for uploads', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, false, mockDb, mockStorage);

      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String), // Content-Type (image/png or application/gzip)
        3600 // 1 hour in seconds
      );
    });
  });

  describe('Content-Type normalization', () => {
    it('should pass normalized lowercase content types to storage', async () => {
      vi.mocked(mockStorage.getPresignedUploadUrl).mockResolvedValue('https://storage/upload');

      await prepareUploadUrls(mockBugReport, true, true, mockDb, mockStorage);

      // Verify screenshot uses normalized 'image/png'
      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        'screenshots/proj-456/bug-123/screenshot.png',
        'image/png', // Normalized to lowercase
        3600
      );

      // Verify replay uses normalized 'application/gzip'
      expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
        'replays/proj-456/bug-123/replay.gz',
        'application/gzip', // Normalized to lowercase
        3600
      );
    });
  });
});

describe('normalizeContentType', () => {
  describe('Basic normalization', () => {
    it('should convert MIME type to lowercase', () => {
      expect(normalizeContentType('Image/Png')).toBe('image/png');
      expect(normalizeContentType('IMAGE/PNG')).toBe('image/png');
      expect(normalizeContentType('APPLICATION/GZIP')).toBe('application/gzip');
      expect(normalizeContentType('Application/Gzip')).toBe('application/gzip');
    });

    it('should handle already lowercase MIME types', () => {
      expect(normalizeContentType('image/png')).toBe('image/png');
      expect(normalizeContentType('application/gzip')).toBe('application/gzip');
      expect(normalizeContentType('text/plain')).toBe('text/plain');
    });

    it('should trim whitespace', () => {
      expect(normalizeContentType('  image/png  ')).toBe('image/png');
      expect(normalizeContentType('\timage/png\n')).toBe('image/png');
      expect(normalizeContentType(' IMAGE/PNG ')).toBe('image/png');
    });
  });

  describe('Parameters handling', () => {
    it('should preserve charset parameter case', () => {
      expect(normalizeContentType('text/html; charset=UTF-8')).toBe('text/html; charset=UTF-8');
      expect(normalizeContentType('TEXT/HTML; charset=UTF-8')).toBe('text/html; charset=UTF-8');
    });

    it('should normalize type/subtype but preserve parameter case', () => {
      expect(normalizeContentType('Text/Plain; CHARSET=UTF-8')).toBe('text/plain; CHARSET=UTF-8');
      expect(normalizeContentType('APPLICATION/JSON; charset=utf-8')).toBe(
        'application/json; charset=utf-8'
      );
    });

    it('should handle multiple parameters', () => {
      expect(normalizeContentType('text/html; charset=UTF-8; boundary=abc123')).toBe(
        'text/html; charset=UTF-8; boundary=abc123'
      );
      expect(normalizeContentType('TEXT/HTML; charset=UTF-8; BOUNDARY=ABC123')).toBe(
        'text/html; charset=UTF-8; BOUNDARY=ABC123'
      );
    });

    it('should handle whitespace around parameters', () => {
      // Normalizes to consistent '; ' (semicolon + space) format per RFC 2045
      expect(normalizeContentType('text/html ; charset=UTF-8')).toBe('text/html; charset=UTF-8');
      expect(normalizeContentType('text/html ;charset=UTF-8')).toBe('text/html; charset=UTF-8');
      expect(normalizeContentType('text/html;  charset=UTF-8')).toBe('text/html; charset=UTF-8'); // Extra spaces normalized
      expect(normalizeContentType('text/html;\tcharset=UTF-8')).toBe('text/html; charset=UTF-8'); // Tab normalized
    });

    it('should filter out empty parameter parts', () => {
      // Empty parts from consecutive semicolons should be removed
      expect(normalizeContentType('text/html;; charset=UTF-8')).toBe('text/html; charset=UTF-8');
      expect(normalizeContentType('text/html; ; charset=UTF-8')).toBe('text/html; charset=UTF-8');
      expect(normalizeContentType('text/html;;;')).toBe('text/html');
    });
  });

  describe('Case normalization (RFC 2045 compliance)', () => {
    it('should normalize common case variations of dangerous types', () => {
      // Utility function normalizes MIME types to lowercase per RFC 2045.
      // Used by validateContentType() to enable case-insensitive allowlist checks.
      expect(normalizeContentType('Text/Html')).toBe('text/html');
      expect(normalizeContentType('TEXT/HTML')).toBe('text/html');
      expect(normalizeContentType('Image/Svg+Xml')).toBe('image/svg+xml');
      expect(normalizeContentType('IMAGE/SVG+XML')).toBe('image/svg+xml');
      expect(normalizeContentType('Application/Javascript')).toBe('application/javascript');
      expect(normalizeContentType('APPLICATION/JAVASCRIPT')).toBe('application/javascript');
    });

    it('should normalize allowed types consistently', () => {
      // Ensures validateContentType() allowlist checks work regardless of case input
      expect(normalizeContentType('Image/Png')).toBe('image/png');
      expect(normalizeContentType('image/PNG')).toBe('image/png');
      expect(normalizeContentType('Application/Gzip')).toBe('application/gzip');
      expect(normalizeContentType('application/GZIP')).toBe('application/gzip');
    });
  });

  describe('RFC 2045 compliance', () => {
    it('should handle various MIME type formats', () => {
      expect(normalizeContentType('application/octet-stream')).toBe('application/octet-stream');
      expect(normalizeContentType('multipart/form-data')).toBe('multipart/form-data');
      expect(normalizeContentType('video/mp4')).toBe('video/mp4');
      expect(normalizeContentType('audio/mpeg')).toBe('audio/mpeg');
    });

    it('should handle types with plus sign', () => {
      expect(normalizeContentType('application/json+ld')).toBe('application/json+ld');
      expect(normalizeContentType('APPLICATION/XML+RDF')).toBe('application/xml+rdf');
    });

    it('should handle vendor-specific types', () => {
      expect(normalizeContentType('application/vnd.api+json')).toBe('application/vnd.api+json');
      expect(normalizeContentType('APPLICATION/VND.MS-EXCEL')).toBe('application/vnd.ms-excel');
    });
  });
});

describe('validateContentType', () => {
  describe('Allowed content types', () => {
    it('should accept and return normalized image/png (screenshots)', () => {
      expect(validateContentType('image/png')).toBe('image/png');
    });

    it('should accept and return normalized application/gzip (replays)', () => {
      expect(validateContentType('application/gzip')).toBe('application/gzip');
    });

    it('should accept case variations and return normalized lowercase', () => {
      // Case-insensitive per RFC 2045 - should normalize and return
      expect(validateContentType('Image/PNG')).toBe('image/png');
      expect(validateContentType('IMAGE/png')).toBe('image/png');
      expect(validateContentType('Application/GZIP')).toBe('application/gzip');
      expect(validateContentType('application/Gzip')).toBe('application/gzip');
    });
  });

  describe('Dangerous MIME types (XSS/XXE prevention)', () => {
    it('should reject text/html (JavaScript execution)', () => {
      expect(() => validateContentType('text/html')).toThrow(
        "Content type 'text/html' is not allowed"
      );
    });

    it('should reject image/svg+xml (embedded scripts)', () => {
      expect(() => validateContentType('image/svg+xml')).toThrow(
        "Content type 'image/svg+xml' is not allowed"
      );
    });

    it('should reject application/javascript (direct script execution)', () => {
      expect(() => validateContentType('application/javascript')).toThrow(
        "Content type 'application/javascript' is not allowed"
      );
    });

    it('should reject text/javascript (legacy script execution)', () => {
      expect(() => validateContentType('text/javascript')).toThrow(
        "Content type 'text/javascript' is not allowed"
      );
    });

    it('should reject text/xml (XXE attacks)', () => {
      expect(() => validateContentType('text/xml')).toThrow(
        "Content type 'text/xml' is not allowed"
      );
    });

    it('should reject application/xml (XXE attacks)', () => {
      expect(() => validateContentType('application/xml')).toThrow(
        "Content type 'application/xml' is not allowed"
      );
    });

    it('should reject application/xhtml+xml (XHTML with script execution)', () => {
      expect(() => validateContentType('application/xhtml+xml')).toThrow(
        "Content type 'application/xhtml+xml' is not allowed"
      );
    });
  });

  describe('Other disallowed types', () => {
    it('should reject application/pdf (not in allowlist)', () => {
      expect(() => validateContentType('application/pdf')).toThrow(
        "Content type 'application/pdf' is not allowed"
      );
    });

    it('should reject image/jpeg (not in allowlist)', () => {
      expect(() => validateContentType('image/jpeg')).toThrow(
        "Content type 'image/jpeg' is not allowed"
      );
    });

    it('should reject video/mp4 (not in allowlist)', () => {
      expect(() => validateContentType('video/mp4')).toThrow(
        "Content type 'video/mp4' is not allowed"
      );
    });
  });

  describe('Error messages', () => {
    it('should provide helpful error message with allowed types list', () => {
      expect(() => validateContentType('text/html')).toThrow(
        /Only the following MIME types are permitted: image\/png, application\/gzip/
      );
    });

    it('should show normalized type in error message', () => {
      // Case variation should be normalized in error message
      expect(() => validateContentType('Text/Html')).toThrow(
        "Content type 'text/html' is not allowed"
      );
    });
  });

  describe('Integration with normalizeContentType', () => {
    it('should normalize and return lowercase for allowed types', () => {
      // Should normalize case variations and return lowercase
      expect(validateContentType('Image/Png')).toBe('image/png');
      expect(validateContentType('IMAGE/PNG')).toBe('image/png');
      expect(validateContentType('Application/Gzip')).toBe('application/gzip');
      expect(validateContentType('APPLICATION/GZIP')).toBe('application/gzip');
    });

    it('should reject dangerous types after normalization', () => {
      // These should throw even with case variations
      expect(() => validateContentType('Text/Html')).toThrow();
      expect(() => validateContentType('IMAGE/SVG+XML')).toThrow();
      expect(() => validateContentType('Application/Javascript')).toThrow();
    });
  });
});
