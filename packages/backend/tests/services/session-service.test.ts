/**
 * SessionService Unit Tests
 * Tests for session data aggregation, replay fetching, and decompression
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { SessionService } from '../../src/services/session-service.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { BugReport } from '../../src/db/types.js';

describe('SessionService', () => {
  let mockStorage: IStorageService;
  let sessionService: SessionService;

  beforeEach(() => {
    // Create mock storage service
    mockStorage = {
      getObject: vi.fn(),
    } as unknown as IStorageService;

    sessionService = new SessionService(mockStorage);
  });

  describe('getSessions', () => {
    it('should return both replay and metadata sessions when both exist', async () => {
      const mockReplayEvents = [
        { type: 2, data: {}, timestamp: 1700000000000 },
        { type: 3, data: { source: 1 }, timestamp: 1700000001000 },
      ];

      // Mock storage to return gzipped replay data
      const gzippedData = gzipSync(JSON.stringify(mockReplayEvents));
      const stream = Readable.from([gzippedData]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: 'replays/proj-456/bug-123/replay.gz',
        replay_upload_status: 'completed',
        metadata: {
          console: [{ level: 'error', message: 'Test error', timestamp: 1700000000000 }],
          network: [{ url: 'https://api.test.com', method: 'GET', status: 200, duration: 100 }],
          metadata: { userAgent: 'Test Browser' },
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(2);

      // Verify replay session
      expect(sessions[0].id).toBe('bug-123-replay');
      expect(sessions[0].bug_report_id).toBe('bug-123');
      expect(sessions[0].events.type).toBe('rrweb');
      expect(sessions[0].events.recordedEvents).toEqual(mockReplayEvents);

      // Verify metadata session
      expect(sessions[1].id).toBe('bug-123-metadata');
      expect(sessions[1].bug_report_id).toBe('bug-123');
      expect(sessions[1].events.type).toBe('metadata');
      expect(sessions[1].events.console).toHaveLength(1);
      expect(sessions[1].events.network).toHaveLength(1);
    });

    it('should return only metadata session when replay does not exist', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: null,
        replay_upload_status: 'none',
        metadata: {
          console: [{ level: 'info', message: 'Test log', timestamp: 1700000000000 }],
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('bug-123-metadata');
      expect(sessions[0].events.type).toBe('metadata');
      expect(mockStorage.getObject).not.toHaveBeenCalled();
    });

    it('should return only replay session when metadata does not exist', async () => {
      const mockReplayEvents = [{ type: 2, data: {}, timestamp: 1700000000000 }];
      const gzippedData = gzipSync(JSON.stringify(mockReplayEvents));
      const stream = Readable.from([gzippedData]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: 'replays/proj-456/bug-123/replay.gz',
        replay_upload_status: 'completed',
        metadata: undefined,
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('bug-123-replay');
      expect(sessions[0].events.type).toBe('rrweb');
    });

    it('should return empty array when neither replay nor metadata exist', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: null,
        replay_upload_status: 'none',
        metadata: undefined,
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toEqual([]);
      expect(mockStorage.getObject).not.toHaveBeenCalled();
    });

    it('should skip replay when upload status is not completed', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: 'replays/proj-456/bug-123/replay.gz',
        replay_upload_status: 'pending',
        metadata: {
          console: [{ level: 'info', message: 'Test', timestamp: 1700000000000 }],
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].events.type).toBe('metadata');
      expect(mockStorage.getObject).not.toHaveBeenCalled();
    });

    it('should handle replay fetch errors gracefully', async () => {
      vi.mocked(mockStorage.getObject).mockRejectedValue(new Error('Storage error'));

      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: 'replays/proj-456/bug-123/replay.gz',
        replay_upload_status: 'completed',
        metadata: {
          console: [{ level: 'info', message: 'Test', timestamp: 1700000000000 }],
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      // Should return only metadata session, not throw error
      expect(sessions).toHaveLength(1);
      expect(sessions[0].events.type).toBe('metadata');
    });

    it('should handle empty metadata gracefully', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: null,
        replay_upload_status: 'none',
        metadata: {},
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toEqual([]);
    });

    it('should handle metadata with only console logs', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: null,
        replay_upload_status: 'none',
        metadata: {
          console: [{ level: 'error', message: 'Error', timestamp: 1700000000000 }],
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].events.console).toHaveLength(1);
      expect(sessions[0].events.network).toEqual([]);
      expect(sessions[0].events.metadata).toEqual({});
    });

    it('should handle metadata with only network requests', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: null,
        replay_upload_status: 'none',
        metadata: {
          network: [{ url: 'https://test.com', method: 'GET', status: 200, duration: 50 }],
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].events.console).toEqual([]);
      expect(sessions[0].events.network).toHaveLength(1);
    });

    it('should handle metadata with only browser metadata', async () => {
      const bugReport: Partial<BugReport> = {
        id: 'bug-123',
        project_id: 'proj-456',
        replay_key: null,
        replay_upload_status: 'none',
        metadata: {
          metadata: {
            userAgent: 'Test Browser',
            viewport: { width: 1920, height: 1080 },
          },
        },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      const sessions = await sessionService.getSessions(bugReport as BugReport);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].events.console).toEqual([]);
      expect(sessions[0].events.network).toEqual([]);
      expect(sessions[0].events.metadata).toMatchObject({
        userAgent: 'Test Browser',
        viewport: { width: 1920, height: 1080 },
      });
    });
  });

  describe('fetchReplayData', () => {
    it('should decompress and parse valid gzipped replay data', async () => {
      const mockReplayEvents = [
        { type: 2, data: { node: {} }, timestamp: 1700000000000 },
        { type: 3, data: { source: 1 }, timestamp: 1700000001000 },
      ];

      const gzippedData = gzipSync(JSON.stringify(mockReplayEvents));
      const stream = Readable.from([gzippedData]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      // Access private method via type assertion for testing
      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toEqual(mockReplayEvents);
      expect(mockStorage.getObject).toHaveBeenCalledWith('replays/test/replay.gz');
    });

    it('should return null when storage fetch fails', async () => {
      vi.mocked(mockStorage.getObject).mockRejectedValue(new Error('Not found'));

      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toBeNull();
    });

    it('should return null when decompression fails', async () => {
      // Invalid gzip data
      const invalidData = Buffer.from('not gzipped data');
      const stream = Readable.from([invalidData]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', async () => {
      // Valid gzip but invalid JSON
      const invalidJson = gzipSync('not valid json');
      const stream = Readable.from([invalidJson]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toBeNull();
    });

    it('should return null when replay data is not an array', async () => {
      const notAnArray = gzipSync(JSON.stringify({ events: [] }));
      const stream = Readable.from([notAnArray]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toBeNull();
    });

    it('should return empty array when replay data is empty', async () => {
      const emptyArray = gzipSync(JSON.stringify([]));
      const stream = Readable.from([emptyArray]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toEqual([]);
    });

    it('should handle large replay files', async () => {
      // Create large replay data (1000 events)
      const largeReplayEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: 3,
        data: { source: 1, positions: [{ x: i, y: i }] },
        timestamp: 1700000000000 + i,
      }));

      const gzippedData = gzipSync(JSON.stringify(largeReplayEvents));
      const stream = Readable.from([gzippedData]);
      vi.mocked(mockStorage.getObject).mockResolvedValue(stream);

      const result = await (sessionService as any).fetchReplayData('replays/test/replay.gz');

      expect(result).toHaveLength(1000);
      expect(result[0].timestamp).toBe(1700000000000);
      expect(result[999].timestamp).toBe(1700000000999);
    });
  });
});
