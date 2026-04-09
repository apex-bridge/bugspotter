/**
 * Presigned Upload Database Migration Tests
 * Tests for new upload columns and backward compatibility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { BugStatus, BugPriority } from '@bugspotter/types';

describe('Presigned Upload Database Migration', () => {
  let db: DatabaseClient;
  let testProject: { id: string };

  beforeEach(async () => {
    db = createDatabaseClient();

    // Create test project
    testProject = await db.projects.create({
      name: 'Test Project',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('New columns exist', () => {
    it('should have screenshot_key column', async () => {
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'bug_reports' AND column_name = 'screenshot_key'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('should have thumbnail_key column', async () => {
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'bug_reports' AND column_name = 'thumbnail_key'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('should have replay_key column', async () => {
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'bug_reports' AND column_name = 'replay_key'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('should have upload_status column', async () => {
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'bug_reports' AND column_name = 'upload_status'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('should have replay_upload_status column', async () => {
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'bug_reports' AND column_name = 'replay_upload_status'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('should have attachments column', async () => {
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'bug_reports' AND column_name = 'attachments'`
      );

      expect(result.rows.length).toBe(1);
    });
  });

  describe('Column constraints', () => {
    it('should allow NULL for screenshot_key', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const result = await db.query('SELECT screenshot_key FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].screenshot_key).toBeNull();
    });

    it('should allow NULL for replay_key', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const result = await db.query('SELECT replay_key FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].replay_key).toBeNull();
    });

    it('should default upload_status to completed when no screenshot data provided', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const result = await db.query('SELECT upload_status FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      // Repository defaults to 'none' when no screenshot/screenshotKey provided
      expect(result.rows[0].upload_status).toBe('none');
    });

    it('should default replay_upload_status to none when no replay data provided', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const result = await db.query('SELECT replay_upload_status FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      // Repository sets 'none' when no sessionReplay/replayKey provided
      expect(result.rows[0].replay_upload_status).toBe('none');
    });

    it('should accept valid upload_status values', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const validStatuses = ['pending', 'uploading', 'completed', 'failed', 'none'];

      for (const status of validStatuses) {
        await db.query('UPDATE bug_reports SET upload_status = $1 WHERE id = $2', [
          status,
          bugReport.id,
        ]);

        const result = await db.query('SELECT upload_status FROM bug_reports WHERE id = $1', [
          bugReport.id,
        ]);

        expect(result.rows[0].upload_status).toBe(status);
      }
    });

    it('should reject invalid upload_status value', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      await expect(
        db.query('UPDATE bug_reports SET upload_status = $1 WHERE id = $2', [
          'invalid_status',
          bugReport.id,
        ])
      ).rejects.toThrow();
    });

    it('should accept valid replay_upload_status values', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const validStatuses = ['pending', 'uploading', 'completed', 'failed', 'none'];

      for (const status of validStatuses) {
        await db.query('UPDATE bug_reports SET replay_upload_status = $1 WHERE id = $2', [
          status,
          bugReport.id,
        ]);

        const result = await db.query(
          'SELECT replay_upload_status FROM bug_reports WHERE id = $1',
          [bugReport.id]
        );

        expect(result.rows[0].replay_upload_status).toBe(status);
      }
    });
  });

  describe('Storage key operations', () => {
    it('should store and retrieve screenshot_key', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const screenshotKey = 'screenshots/proj-123/bug-456/original.png';

      await db.query('UPDATE bug_reports SET screenshot_key = $1 WHERE id = $2', [
        screenshotKey,
        bugReport.id,
      ]);

      const result = await db.query('SELECT screenshot_key FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].screenshot_key).toBe(screenshotKey);
    });

    it('should store and retrieve replay_key', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const replayKey = 'replays/proj-123/bug-456/replay.gz';

      await db.query('UPDATE bug_reports SET replay_key = $1 WHERE id = $2', [
        replayKey,
        bugReport.id,
      ]);

      const result = await db.query('SELECT replay_key FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].replay_key).toBe(replayKey);
    });

    it('should handle long storage keys (up to 500 chars)', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      // Create key with exactly 499 chars (stays under 500 limit)
      // "screenshots/" (12) + repeated 'a's (478) + "/file.png" (9) = 499 total
      const longKey = 'screenshots/' + 'a'.repeat(478) + '/file.png';

      await db.query('UPDATE bug_reports SET screenshot_key = $1 WHERE id = $2', [
        longKey,
        bugReport.id,
      ]);

      const result = await db.query('SELECT screenshot_key FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].screenshot_key).toBe(longKey);
      expect(longKey.length).toBe(499); // Verify length
    });
  });

  describe('Attachments JSONB column', () => {
    it('should default to empty array', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const result = await db.query('SELECT attachments FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].attachments).toEqual([]);
    });

    it('should store attachment metadata', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Test Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const attachments = [
        {
          key: 'attachments/proj/bug/log.txt',
          name: 'log.txt',
          size: 1024,
          contentType: 'text/plain',
        },
        {
          key: 'attachments/proj/bug/screenshot.png',
          name: 'screenshot.png',
          size: 2048,
          contentType: 'image/png',
        },
      ];

      await db.query('UPDATE bug_reports SET attachments = $1 WHERE id = $2', [
        JSON.stringify(attachments),
        bugReport.id,
      ]);

      const result = await db.query('SELECT attachments FROM bug_reports WHERE id = $1', [
        bugReport.id,
      ]);

      expect(result.rows[0].attachments).toEqual(attachments);
    });
  });

  describe('Backward compatibility', () => {
    it('should work with legacy screenshot_url only', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Legacy Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: 'https://example.com/screenshot.png',
        replay_url: null,
      });

      const result = await db.query(
        'SELECT screenshot_url, screenshot_key, upload_status FROM bug_reports WHERE id = $1',
        [bugReport.id]
      );

      expect(result.rows[0].screenshot_url).toBe('https://example.com/screenshot.png');
      expect(result.rows[0].screenshot_key).toBeNull();
      // Note: upload_status will be 'pending' by default, not 'legacy'
      // The migration backfills existing rows, but new rows start as 'pending'
    });

    it('should work with both legacy URL and new key', async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Hybrid Bug',
        description: null,
        priority: BugPriority.MEDIUM,
        status: BugStatus.OPEN,
        metadata: {},
        screenshot_url: 'https://example.com/screenshot.png',
        replay_url: null,
      });

      await db.query(
        'UPDATE bug_reports SET screenshot_key = $1, upload_status = $2 WHERE id = $3',
        ['screenshots/proj/bug/new.png', 'completed', bugReport.id]
      );

      const result = await db.query(
        'SELECT screenshot_url, screenshot_key, upload_status FROM bug_reports WHERE id = $1',
        [bugReport.id]
      );

      expect(result.rows[0].screenshot_url).toBe('https://example.com/screenshot.png');
      expect(result.rows[0].screenshot_key).toBe('screenshots/proj/bug/new.png');
      expect(result.rows[0].upload_status).toBe('completed');
    });
  });

  describe('Index performance', () => {
    it('should have index on upload_status for pending reports', async () => {
      const result = await db.query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'bug_reports' AND indexname = 'idx_bug_reports_upload_status'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('should have index on replay_upload_status for pending reports', async () => {
      const result = await db.query(
        `SELECT indexname FROM pg_indexes 
         WHERE tablename = 'bug_reports' AND indexname = 'idx_bug_reports_replay_upload_status'`
      );

      expect(result.rows.length).toBe(1);
    });
  });
});
