/**
 * Unit tests for storage service
 * Tests fetching, decompressing, and downloading replay files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { storageService } from '../../services/storage-service';
import type { RRWebEvent } from '@bugspotter/types';
import pako from 'pako';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock the API client
vi.mock('../../lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../../lib/api-client';

// Type helper for axios mock responses
type MockAxiosResponse<T> = { data: T };

describe('Storage Service', () => {
  const TEST_REPLAY_PATH = join(__dirname, '../e2e/fixtures/test-replay.gz');
  let mockReplayData: Buffer;
  let mockReplayEvents: RRWebEvent[];

  beforeEach(() => {
    vi.clearAllMocks();

    // Load the actual test replay file
    try {
      mockReplayData = readFileSync(TEST_REPLAY_PATH);
      const decompressed = pako.ungzip(mockReplayData, { to: 'string' });
      const parsed = JSON.parse(decompressed);
      mockReplayEvents = Array.isArray(parsed) ? parsed : parsed.events || [];
    } catch {
      console.warn('⚠️ Test replay file not found, using mock data');
      // Fallback to mock data
      mockReplayEvents = [
        { type: 2, timestamp: 1000, data: {} },
        { type: 3, timestamp: 2000, data: {} },
      ];
      const compressed = pako.gzip(JSON.stringify(mockReplayEvents));
      mockReplayData = Buffer.from(compressed);
    }

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchReplayEvents', () => {
    it('should fetch presigned URL and decompress replay successfully', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      // Mock API call to get presigned URL (axios response structure)
      vi.mocked(api.get).mockResolvedValueOnce({
        data: {
          url: mockPresignedUrl,
          key: 'replays/project/bug/replay.gz',
          expiresIn: 3600,
        },
      } as MockAxiosResponse<{ url: string; key: string; expiresIn: number }>);

      // Mock fetch to return compressed replay data
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockReplayData.buffer,
      } as Response);

      const events = await storageService.fetchReplayEvents(bugReportId);

      expect(api.get).toHaveBeenCalledWith(`/api/v1/storage/url/${bugReportId}/replay`);
      expect(global.fetch).toHaveBeenCalledWith(mockPresignedUrl);
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    it('should include share token in URL when provided', async () => {
      const bugReportId = 'test-bug-id';
      const shareToken = 'abc123token';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      vi.mocked(api.get).mockResolvedValueOnce({
        data: {
          url: mockPresignedUrl,
          key: 'replays/project/bug/replay.gz',
          expiresIn: 3600,
        },
      } as MockAxiosResponse<{ url: string; key: string; expiresIn: number }>);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockReplayData.buffer,
      } as Response);

      await storageService.fetchReplayEvents(bugReportId, shareToken);

      expect(api.get).toHaveBeenCalledWith(
        `/api/v1/storage/url/${bugReportId}/replay?shareToken=${shareToken}`
      );
    });

    it('should use POST for password-protected shares (security)', async () => {
      const bugReportId = 'test-bug-id';
      const shareToken = 'abc123token';
      const shareTokenPassword = 'secretpass';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          url: mockPresignedUrl,
          key: 'replays/project/bug/replay.gz',
          expiresIn: 3600,
        },
      } as MockAxiosResponse<{ url: string; key: string; expiresIn: number }>);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockReplayData.buffer,
      } as Response);

      await storageService.fetchReplayEvents(bugReportId, shareToken, shareTokenPassword);

      // Verify POST used instead of GET (password in body, not URL)
      expect(api.post).toHaveBeenCalledWith(`/api/v1/storage/url/${bugReportId}/replay`, {
        shareToken,
        shareTokenPassword,
      });
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should handle array format replay data', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      const arrayEvents = [
        { type: 2, timestamp: 1000, data: {} },
        { type: 3, timestamp: 2000, data: {} },
      ];
      const compressed = pako.gzip(JSON.stringify(arrayEvents));

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength
          ),
      } as Response);

      const events = await storageService.fetchReplayEvents(bugReportId);

      expect(events).toEqual(arrayEvents);
    });

    it('should handle object format replay data with events property', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      const objectEvents = {
        events: [
          { type: 2, timestamp: 1000, data: {} },
          { type: 3, timestamp: 2000, data: {} },
        ],
        metadata: { version: '1.0' },
      };
      const compressed = pako.gzip(JSON.stringify(objectEvents));

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength
          ),
      } as Response);

      const events = await storageService.fetchReplayEvents(bugReportId);

      expect(events).toEqual(objectEvents.events);
    });

    it('should throw error if presigned URL fetch fails', async () => {
      const bugReportId = 'test-bug-id';

      vi.mocked(api.get).mockRejectedValueOnce(new Error('API error'));

      await expect(storageService.fetchReplayEvents(bugReportId)).rejects.toThrow('API error');
    });

    it('should throw error if storage download fails', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(storageService.fetchReplayEvents(bugReportId)).rejects.toThrow(
        'Failed to fetch replay: Not Found'
      );
    });

    it('should throw error if decompression fails', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10), // Invalid gzip data
      } as Response);

      await expect(storageService.fetchReplayEvents(bugReportId)).rejects.toThrow();
    });

    it('should throw error if decompressed data is not valid JSON', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      const invalidJson = pako.gzip('not valid json');

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from(invalidJson).buffer,
      } as Response);

      await expect(storageService.fetchReplayEvents(bugReportId)).rejects.toThrow();
    });

    it('should handle production replay file correctly', async () => {
      // Skip if test file not available
      if (mockReplayEvents.length === 2) {
        console.log('⚠️ Skipping production file test - using mock data');
        return;
      }

      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockReplayData.buffer,
      } as Response);

      const events = await storageService.fetchReplayEvents(bugReportId);

      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(81); // Production file has 81 events

      // Validate event structure
      events.forEach((event) => {
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('timestamp');
        expect(typeof event.type).toBe('number');
        expect(typeof event.timestamp).toBe('number');
      });

      // Check for rrweb event types (0-5)
      const validTypes = [0, 1, 2, 3, 4, 5];
      events.forEach((event) => {
        expect(validTypes).toContain(event.type);
      });

      // Verify chronological order
      for (let i = 1; i < events.length; i++) {
        expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
      }
    });
  });

  describe('downloadResource', () => {
    it('should fetch presigned URL and initiate download', async () => {
      const bugReportId = 'test-bug-id';
      const resourceType = 'screenshot';
      const mockPresignedUrl = 'https://storage.example.com/screenshot.png';

      vi.mocked(api.get).mockResolvedValueOnce({
        data: {
          url: mockPresignedUrl,
          key: 'screenshots/project/bug/original.png',
        },
      } as MockAxiosResponse<{ url: string; key: string }>);

      // Mock document.createElement to capture anchor element
      const mockLink = {
        href: '',
        download: '',
        target: '',
        click: vi.fn(),
      };
      const createElement = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(mockLink as unknown as HTMLAnchorElement);

      await storageService.downloadResource(bugReportId, resourceType);

      expect(api.get).toHaveBeenCalledWith(`/api/v1/storage/url/${bugReportId}/${resourceType}`);
      expect(createElement).toHaveBeenCalledWith('a');
      expect(mockLink.href).toBe(mockPresignedUrl);
      expect(mockLink.target).toBe('_blank');
      expect(mockLink.download).toBe(`${resourceType}-${bugReportId}`);
      expect(mockLink.click).toHaveBeenCalled();

      createElement.mockRestore();
    });

    it('should handle download errors gracefully', async () => {
      const bugReportId = 'test-bug-id';
      const resourceType = 'replay';

      vi.mocked(api.get).mockRejectedValueOnce(new Error('API error'));

      await expect(storageService.downloadResource(bugReportId, resourceType)).rejects.toThrow(
        'API error'
      );
    });

    it('should work for different resource types', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/file';

      // Mock document methods
      const mockLink = { href: '', download: '', target: '', click: vi.fn() };
      const createElement = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(mockLink as unknown as HTMLAnchorElement);

      // Test screenshot
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      await storageService.downloadResource(bugReportId, 'screenshot');
      expect(api.get).toHaveBeenCalledWith(`/api/v1/storage/url/${bugReportId}/screenshot`);
      expect(mockLink.download).toBe('screenshot-test-bug-id');

      // Test replay
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      await storageService.downloadResource(bugReportId, 'replay');
      expect(api.get).toHaveBeenCalledWith(`/api/v1/storage/url/${bugReportId}/replay`);
      expect(mockLink.download).toBe('replay-test-bug-id');

      createElement.mockRestore();
    });

    it('should use custom filename when provided', async () => {
      const bugReportId = 'test-bug-id';
      const resourceType = 'screenshot';
      const customFilename = 'my-screenshot.png';
      const mockPresignedUrl = 'https://storage.example.com/screenshot.png';

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);

      const mockLink = { href: '', download: '', target: '', click: vi.fn() };
      const createElement = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(mockLink as unknown as HTMLAnchorElement);

      await storageService.downloadResource(bugReportId, resourceType, customFilename);

      expect(mockLink.download).toBe(customFilename);

      createElement.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty replay events array', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      const emptyEvents: RRWebEvent[] = [];
      const compressed = pako.gzip(JSON.stringify(emptyEvents));

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength
          ),
      } as Response);

      const events = await storageService.fetchReplayEvents(bugReportId);

      expect(events).toEqual([]);
    });

    it('should handle large replay files', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      // Create a large replay file (1000 events)
      const largeEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: 3,
        timestamp: 1000 + i * 100,
        data: { source: 2, positions: [] },
      }));
      const compressed = pako.gzip(JSON.stringify(largeEvents));

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength
          ),
      } as Response);

      const events = await storageService.fetchReplayEvents(bugReportId);

      expect(events.length).toBe(1000);
      expect(events[0].timestamp).toBe(1000);
      expect(events[999].timestamp).toBe(1000 + 999 * 100);
    });

    it('should handle malformed replay data structure gracefully', async () => {
      const bugReportId = 'test-bug-id';
      const mockPresignedUrl = 'https://storage.example.com/replay.gz';

      // Object without events property and not an array
      const malformedData = { metadata: 'test', notEvents: [] };
      const compressed = pako.gzip(JSON.stringify(malformedData));

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { url: mockPresignedUrl },
      } as MockAxiosResponse<{ url: string }>);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from(compressed).buffer,
      } as Response);

      await expect(storageService.fetchReplayEvents(bugReportId)).rejects.toThrow();
    });

    it('should handle network timeouts', async () => {
      const bugReportId = 'test-bug-id';

      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network timeout'));

      await expect(storageService.fetchReplayEvents(bugReportId)).rejects.toThrow(
        'Network timeout'
      );
    });
  });
});
