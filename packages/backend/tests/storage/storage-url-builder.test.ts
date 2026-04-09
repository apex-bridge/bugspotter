/**
 * Tests for Storage URL Builder
 * Ensures consistent API URL generation for stored resources
 */

import { describe, it, expect } from 'vitest';
import { buildScreenshotUrl, buildAttachmentUrl } from '../../src/storage/storage-url-builder.js';

describe('Storage URL Builder', () => {
  const projectId = 'proj-123';
  const bugReportId = 'bug-456';

  describe('buildScreenshotUrl', () => {
    it('should build original screenshot URL by default', () => {
      const url = buildScreenshotUrl(projectId, bugReportId);
      expect(url).toBe('/api/v1/storage/screenshots/proj-123/bug-456/original.png');
    });

    it('should build original screenshot URL explicitly', () => {
      const url = buildScreenshotUrl(projectId, bugReportId, 'original');
      expect(url).toBe('/api/v1/storage/screenshots/proj-123/bug-456/original.png');
    });

    it('should build thumbnail screenshot URL', () => {
      const url = buildScreenshotUrl(projectId, bugReportId, 'thumbnail');
      expect(url).toBe('/api/v1/storage/screenshots/proj-123/bug-456/thumbnail.jpg');
    });
  });

  describe('buildAttachmentUrl', () => {
    it('should build attachment URL with filename', () => {
      const url = buildAttachmentUrl(projectId, bugReportId, 'test.pdf');
      expect(url).toBe('/api/v1/storage/attachments/proj-123/bug-456/test.pdf');
    });

    it('should preserve filename extensions', () => {
      const url = buildAttachmentUrl(projectId, bugReportId, 'report.log.txt');
      expect(url).toBe('/api/v1/storage/attachments/proj-123/bug-456/report.log.txt');
    });
  });

  describe('URL consistency', () => {
    it('should use consistent API base path across all builders', () => {
      const screenshotUrl = buildScreenshotUrl(projectId, bugReportId);
      const attachmentUrl = buildAttachmentUrl(projectId, bugReportId, 'test.txt');

      expect(screenshotUrl).toMatch(/^\/api\/v1\/storage\//);
      expect(attachmentUrl).toMatch(/^\/api\/v1\/storage\//);
    });
  });
});
