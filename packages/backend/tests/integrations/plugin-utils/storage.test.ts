/**
 * Tests for storage utilities
 */

import { describe, it, expect, vi } from 'vitest';
import { getResourceUrls } from '../../../src/integrations/plugin-utils/storage.js';
import type {
  StorageContext,
  BugReportWithResources,
} from '../../../src/integrations/plugin-utils/storage.js';

describe('Plugin Utils - Storage', () => {
  describe('getResourceUrls', () => {
    it('should get URLs for all resources', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn().mockImplementation((path: string) => {
          return Promise.resolve(`https://storage.example.com/${path}?signature=abc123`);
        }),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'proj-123',
        screenshot_url: 'screenshots/bug-1/image.png',
        replay_url: 'replays/bug-1/session.json',
        video_url: 'videos/bug-1/recording.mp4',
        logs_url: 'logs/bug-1/console.log',
      };

      const urls = await getResourceUrls(mockContext, bugReport);

      expect(urls).toEqual({
        screenshot: 'https://storage.example.com/screenshots/bug-1/image.png?signature=abc123',
        replay: 'https://storage.example.com/replays/bug-1/session.json?signature=abc123',
        video: 'https://storage.example.com/videos/bug-1/recording.mp4?signature=abc123',
        logs: 'https://storage.example.com/logs/bug-1/console.log?signature=abc123',
      });

      expect(mockContext.getPresignedUrl).toHaveBeenCalledTimes(4);
      expect(mockContext.getPresignedUrl).toHaveBeenCalledWith(
        'screenshots/bug-1/image.png',
        'proj-123'
      );
      expect(mockContext.getPresignedUrl).toHaveBeenCalledWith(
        'replays/bug-1/session.json',
        'proj-123'
      );
    });

    it('should only include available resources', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn().mockResolvedValue('https://storage.example.com/file'),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'proj-123',
        screenshot_url: 'screenshots/bug-1/image.png',
        replay_url: null,
        video_url: undefined,
      };

      const urls = await getResourceUrls(mockContext, bugReport);

      expect(urls).toEqual({
        screenshot: 'https://storage.example.com/file',
      });

      expect(mockContext.getPresignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should handle missing resources gracefully', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn(),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'proj-123',
      };

      const urls = await getResourceUrls(mockContext, bugReport);

      expect(urls).toEqual({});
      expect(mockContext.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('should skip resources that fail to generate URLs', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn().mockImplementation((path: string) => {
          if (path === 'screenshots/bug-1/image.png') {
            return Promise.resolve('https://storage.example.com/screenshot');
          }
          if (path === 'replays/bug-1/missing.json') {
            return Promise.reject(new Error('File not found'));
          }
          return Promise.resolve(`https://storage.example.com/${path}`);
        }),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'proj-123',
        screenshot_url: 'screenshots/bug-1/image.png',
        replay_url: 'replays/bug-1/missing.json',
        video_url: 'videos/bug-1/recording.mp4',
      };

      const urls = await getResourceUrls(mockContext, bugReport);

      // replay_url should be skipped due to error
      expect(urls).toEqual({
        screenshot: 'https://storage.example.com/screenshot',
        video: 'https://storage.example.com/videos/bug-1/recording.mp4',
      });

      expect(mockContext.getPresignedUrl).toHaveBeenCalledTimes(3);
    });

    it('should handle non-string resource paths', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn().mockResolvedValue('https://storage.example.com/file'),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'proj-123',
        screenshot_url: 'screenshots/image.png',
        replay_url: 123 as any, // Invalid type
        video_url: [] as any, // Invalid type
        logs_url: {} as any, // Invalid type
      };

      const urls = await getResourceUrls(mockContext, bugReport);

      // Only screenshot should be processed
      expect(urls).toEqual({
        screenshot: 'https://storage.example.com/file',
      });

      expect(mockContext.getPresignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should pass project_id to getPresignedUrl', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn().mockResolvedValue('https://storage.example.com/file'),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'custom-project-456',
        screenshot_url: 'screenshots/image.png',
      };

      await getResourceUrls(mockContext, bugReport);

      expect(mockContext.getPresignedUrl).toHaveBeenCalledWith(
        'screenshots/image.png',
        'custom-project-456'
      );
    });

    it('should handle all resource types independently', async () => {
      const mockContext: StorageContext = {
        getPresignedUrl: vi.fn().mockImplementation((path: string) => {
          // Fail only screenshot
          if (path.includes('screenshot')) {
            return Promise.reject(new Error('Screenshot missing'));
          }
          return Promise.resolve(`https://storage.example.com/${path}`);
        }),
      };

      const bugReport: BugReportWithResources = {
        project_id: 'proj-123',
        screenshot_url: 'screenshots/missing.png',
        replay_url: 'replays/session.json',
        video_url: 'videos/recording.mp4',
        logs_url: 'logs/console.log',
      };

      const urls = await getResourceUrls(mockContext, bugReport);

      // All except screenshot should succeed
      expect(urls).toEqual({
        replay: 'https://storage.example.com/replays/session.json',
        video: 'https://storage.example.com/videos/recording.mp4',
        logs: 'https://storage.example.com/logs/console.log',
      });
    });
  });
});
