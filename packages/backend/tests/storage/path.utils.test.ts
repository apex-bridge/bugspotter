/**
 * Unit tests for path utilities with comprehensive security testing
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  buildStorageKey,
  sanitizeS3Key,
  validateProjectId,
  validateBugId,
  isValidUUID,
} from '../../src/storage/path-utils.js';

describe('Path Utils', () => {
  describe('sanitizeFilename', () => {
    describe('Path Traversal Prevention', () => {
      it('should prevent basic path traversal attacks', () => {
        expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
        expect(sanitizeFilename('../../secret.txt')).toBe('secret.txt');
        expect(sanitizeFilename('../file.txt')).toBe('file.txt');
        expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('system32');
      });

      it('should prevent URL-encoded path traversal', () => {
        expect(sanitizeFilename('%2e%2e%2f%2e%2e%2fetc%2fpasswd')).toBe('passwd');
        expect(sanitizeFilename('%2e%2e/file.txt')).toBe('file.txt');
      });

      it('should prevent double-encoded attacks', () => {
        expect(sanitizeFilename('%252e%252e%252f')).not.toContain('..');
      });

      it('should remove null bytes', () => {
        const result = sanitizeFilename('file\x00.txt');
        expect(result).not.toContain('\x00');
        expect(result).toBe('file.txt');
      });

      it('should reject absolute paths', () => {
        expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
        expect(sanitizeFilename('C:\\Windows\\System32')).toBe('System32');
        expect(sanitizeFilename('/var/www/html/index.php')).toBe('index.php');
      });
    });

    describe('S3/MinIO Compatibility', () => {
      it('should only allow safe characters', () => {
        expect(sanitizeFilename('my file.txt')).toBe('my_file.txt');
        expect(sanitizeFilename('file@#$%.txt')).toBe('file.txt'); // URL decode removes @#$%
        expect(sanitizeFilename('hello world!')).toBe('hello_world');
      });

      it('should replace non-alphanumeric characters', () => {
        expect(sanitizeFilename("file's-name_123.txt")).toBe('file_s-name_123.txt');
        expect(sanitizeFilename('data(2024).csv')).toBe('data_2024.csv');
        expect(sanitizeFilename('file*test.txt')).toBe('file_test.txt');
      });

      it('should handle dangerous HTML/XML characters', () => {
        expect(sanitizeFilename('file<>name.txt')).toBe('file__name.txt');
        expect(sanitizeFilename('data&query=1.json')).toBe('data_query_1.json');
        expect(sanitizeFilename('file\"name\".txt')).toBe('file_name.txt');
      });

      it('should enforce maximum length of 255 characters', () => {
        const longName = 'a'.repeat(500) + '.txt';
        const result = sanitizeFilename(longName);
        expect(result.length).toBeLessThanOrEqual(255);
        expect(result).toMatch(/\.txt$/); // Extension preserved
      });
    });

    describe('Windows Reserved Names', () => {
      it('should handle Windows reserved names', () => {
        expect(sanitizeFilename('CON')).toMatch(/^_CON$/);
        expect(sanitizeFilename('PRN.txt')).toMatch(/^_PRN\.txt$/);
        expect(sanitizeFilename('AUX')).toMatch(/^_AUX$/);
        expect(sanitizeFilename('NUL.log')).toMatch(/^_NUL\.log$/);
      });

      it('should handle COM and LPT ports', () => {
        expect(sanitizeFilename('COM1')).toMatch(/^_COM1$/);
        expect(sanitizeFilename('COM9.txt')).toMatch(/^_COM9\.txt$/);
        expect(sanitizeFilename('LPT1')).toMatch(/^_LPT1$/);
        expect(sanitizeFilename('LPT9.txt')).toMatch(/^_LPT9\.txt$/);
      });

      it('should be case-insensitive for reserved names', () => {
        expect(sanitizeFilename('con')).toMatch(/^_con$/);
        expect(sanitizeFilename('Con.TXT')).toMatch(/^_Con\.TXT$/);
        expect(sanitizeFilename('COM1')).toMatch(/^_COM1$/);
      });
    });

    describe('Edge Cases', () => {
      it('should generate safe names for empty inputs', () => {
        const result1 = sanitizeFilename('');
        const result2 = sanitizeFilename('   ');
        const result3 = sanitizeFilename('\t\n');

        expect(result1).toMatch(/^unnamed_\d+/);
        expect(result2).toMatch(/^unnamed_\d+/);
        expect(result3).toMatch(/^unnamed_\d+/);
      });

      it('should handle dot files correctly', () => {
        expect(sanitizeFilename('.htaccess')).toBe('htaccess');
        expect(sanitizeFilename('.hidden')).toBe('hidden');
        expect(sanitizeFilename('..hidden')).toBe('hidden');
        expect(sanitizeFilename('...hidden')).toBe('hidden');
      });

      it('should preserve multiple extensions correctly', () => {
        expect(sanitizeFilename('archive.tar.gz')).toBe('archive.tar.gz');
        expect(sanitizeFilename('backup.sql.bz2')).toBe('backup.sql.bz2');
        expect(sanitizeFilename('data.json.gz')).toBe('data.json.gz');
      });

      it('should handle Unicode and emoji', () => {
        expect(sanitizeFilename('café.txt')).toBe('caf.txt');
        expect(sanitizeFilename('file-🎉.txt')).toBe('file.txt'); // Emoji removed, trailing hyphen removed
        expect(sanitizeFilename('日本語.txt')).toMatch(/^unnamed_\d+/);
      });

      it('should handle only special characters', () => {
        // After removing invalid chars and trailing underscores, these become empty
        expect(sanitizeFilename('####')).toMatch(/^unnamed_\d+/);
        expect(sanitizeFilename('////')).toMatch(/^unnamed_\d+/);
        expect(sanitizeFilename('@@@')).toMatch(/^unnamed_\d+/);
        expect(sanitizeFilename('???')).toMatch(/^unnamed_\d+/);
      });

      it('should remove trailing dots and spaces', () => {
        expect(sanitizeFilename('file.txt...')).toBe('file.txt');
        expect(sanitizeFilename('file.txt   ')).toBe('file.txt');
        expect(sanitizeFilename('file.txt. . .')).toBe('file.txt');
      });

      it('should preserve extension when truncating', () => {
        const longNameWithExt = 'a'.repeat(260) + '.important';
        const result = sanitizeFilename(longNameWithExt);
        expect(result.length).toBeLessThanOrEqual(255);
        expect(result).toMatch(/\.important$/);
      });
    });

    describe('Security Logging', () => {
      it('should handle malicious patterns without crashing', () => {
        const maliciousInputs = [
          '../../../etc/passwd\x00.txt',
          '%2e%2e%2f%2e%2e%2f%2e%2e%2f',
          'CON',
          '\x00\x01\x02\x03',
          '<?php eval($_GET["cmd"]); ?>',
          '<script>alert("xss")</script>',
          '../../../../../../windows/win.ini',
        ];

        maliciousInputs.forEach((input) => {
          const result = sanitizeFilename(input);
          expect(result).toBeTruthy();
          expect(result).not.toContain('..');
          expect(result).not.toContain('/');
          expect(result).not.toContain('\\');
          expect(result).not.toContain('\x00');
        });
      });
    });
  });

  describe('sanitizeS3Key', () => {
    it('should validate and clean S3 keys', () => {
      expect(sanitizeS3Key('screenshots/proj-1/bug-123/file.png')).toBe(
        'screenshots/proj-1/bug-123/file.png'
      );
    });

    it('should remove leading and trailing slashes', () => {
      expect(sanitizeS3Key('/path/to/file.txt')).toBe('path/to/file.txt');
      expect(sanitizeS3Key('path/to/file.txt/')).toBe('path/to/file.txt');
      expect(sanitizeS3Key('//path//to//file.txt//')).toBe('path/to/file.txt');
    });

    it('should normalize multiple slashes', () => {
      expect(sanitizeS3Key('path///to///file.txt')).toBe('path/to/file.txt');
    });

    it('should reject path traversal sequences', () => {
      // Changed from "remove" to "reject" for consistent security validation
      expect(() => sanitizeS3Key('path/../to/./file.txt')).toThrow('path traversal');
      expect(() => sanitizeS3Key('screenshots/../secrets/file.txt')).toThrow('path traversal');
      expect(() => sanitizeS3Key('valid/path/./file.txt')).toThrow('path traversal');
    });

    it('should throw on keys that are too long', () => {
      const longKey = 'a'.repeat(1100);
      expect(() => sanitizeS3Key(longKey)).toThrow('too long');
    });

    it('should normalize empty segments', () => {
      // Multiple slashes get normalized to single slash
      expect(sanitizeS3Key('path//file.txt')).toBe('path/file.txt');
    });

    it('should throw on invalid input', () => {
      expect(() => sanitizeS3Key('')).toThrow('must be a non-empty string');
    });
  });

  describe('UUID Validation', () => {
    describe('isValidUUID', () => {
      it('should validate correct UUID v4', () => {
        expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
        expect(isValidUUID('6ba7b810-9dad-41d1-80b4-00c04fd430c8')).toBe(true); // v1 also passes basic UUID format check
        expect(isValidUUID('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true);
      });

      it('should reject invalid UUIDs', () => {
        expect(isValidUUID('not-a-uuid')).toBe(false);
        expect(isValidUUID('123')).toBe(false);
        expect(isValidUUID('')).toBe(false);
        expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false); // wrong version
      });

      it('should handle case insensitivity', () => {
        expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
        expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
      });
    });

    describe('validateProjectId', () => {
      it('should validate and normalize valid project IDs', () => {
        const validId = '550e8400-e29b-41d4-a716-446655440000';
        expect(validateProjectId(validId)).toBe(validId.toLowerCase());
        expect(validateProjectId(validId.toUpperCase())).toBe(validId.toLowerCase());
      });

      it('should trim whitespace', () => {
        const validId = '550e8400-e29b-41d4-a716-446655440000';
        expect(validateProjectId(`  ${validId}  `)).toBe(validId);
      });

      it('should throw on invalid project IDs', () => {
        expect(() => validateProjectId('invalid', { strict: true })).toThrow('Invalid project ID');
        expect(() => validateProjectId('')).toThrow('Project ID is required');
        expect(() => validateProjectId('123-456', { strict: true })).toThrow('Invalid project ID');
      });
    });

    describe('validateBugId', () => {
      it('should validate and normalize valid bug IDs', () => {
        const validId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
        expect(validateBugId(validId)).toBe(validId.toLowerCase());
      });

      it('should throw on invalid bug IDs', () => {
        expect(() => validateBugId('invalid', { strict: true })).toThrow('Invalid bug ID');
        expect(() => validateBugId('')).toThrow('Bug ID is required');
      });
    });
  });

  describe('buildStorageKey', () => {
    it('should build correct storage key path', () => {
      expect(buildStorageKey('screenshots', 'proj-1', 'bug-123', 'original.png')).toBe(
        'screenshots/proj-1/bug-123/original.png'
      );
      expect(buildStorageKey('replays', 'proj-2', 'bug-456', 'metadata.json')).toBe(
        'replays/proj-2/bug-456/metadata.json'
      );
      expect(buildStorageKey('attachments', 'proj-3', 'bug-789', 'report.pdf')).toBe(
        'attachments/proj-3/bug-789/report.pdf'
      );
    });

    it('should handle nested filenames', () => {
      expect(buildStorageKey('replays', 'proj-1', 'bug-123', 'chunks/0.json.gz')).toBe(
        'replays/proj-1/bug-123/chunks/0.json.gz'
      );
      expect(buildStorageKey('screenshots', 'proj-1', 'bug-123', 'thumbnails/small.jpg')).toBe(
        'screenshots/proj-1/bug-123/thumbnails/small.jpg'
      );
    });

    it('should handle special characters in IDs', () => {
      expect(buildStorageKey('screenshots', 'proj_123', 'bug-456-abc', 'file.png')).toBe(
        'screenshots/proj_123/bug-456-abc/file.png'
      );
      expect(buildStorageKey('attachments', 'Project.1', 'Bug#999', 'data.txt')).toBe(
        'attachments/Project.1/Bug#999/data.txt'
      );
    });

    it('should reject empty filename', () => {
      expect(() => buildStorageKey('screenshots', 'proj-1', 'bug-123', '')).toThrow(
        'All parameters are required'
      );
    });

    it('should reject path traversal in filename', () => {
      // buildStorageKey now validates inputs for security
      expect(() => buildStorageKey('screenshots', 'proj-1', 'bug-123', '../secret.png')).toThrow(
        'Invalid characters in filename'
      );
    });

    it('should reject invalid storage types', () => {
      expect(() => buildStorageKey('../../secrets', 'proj-1', 'bug-123', 'file.txt')).toThrow(
        'Invalid storage type'
      );
      expect(() => buildStorageKey('malicious', 'proj-1', 'bug-123', 'file.txt')).toThrow(
        'Invalid storage type'
      );
    });

    it('should reject path traversal in type', () => {
      expect(() => buildStorageKey('../secrets', 'proj-1', 'bug-123', 'file.txt')).toThrow();
    });

    it('should reject path traversal in projectId', () => {
      expect(() => buildStorageKey('screenshots', '../proj', 'bug-123', 'file.txt')).toThrow(
        'Invalid characters in project ID'
      );
    });

    it('should reject path traversal in bugId', () => {
      expect(() => buildStorageKey('screenshots', 'proj-1', '../bug', 'file.txt')).toThrow(
        'Invalid characters in bug ID'
      );
    });

    it('should reject backslashes (Windows path separators)', () => {
      expect(() => buildStorageKey('screenshots', 'proj\\1', 'bug-123', 'file.txt')).toThrow();
      expect(() => buildStorageKey('screenshots', 'proj-1', 'bug\\123', 'file.txt')).toThrow();
      expect(() => buildStorageKey('screenshots', 'proj-1', 'bug-123', 'file\\hack.txt')).toThrow();
    });

    it('should reject null bytes', () => {
      expect(() => buildStorageKey('screenshots', 'proj\x00', 'bug-123', 'file.txt')).toThrow();
      expect(() => buildStorageKey('screenshots', 'proj-1', 'bug\x00123', 'file.txt')).toThrow();
      expect(() => buildStorageKey('screenshots', 'proj-1', 'bug-123', 'file\x00.txt')).toThrow();
    });
  });

  describe('Integration: sanitizeFilename + buildStorageKey', () => {
    it('should work together to create safe paths', () => {
      const unsafeFilename = '../../etc/passwd';
      const safeFilename = sanitizeFilename(unsafeFilename);
      const key = buildStorageKey('attachments', 'proj-1', 'bug-123', safeFilename);

      expect(key).toBe('attachments/proj-1/bug-123/passwd');
      expect(key).not.toContain('..');
    });

    it('should handle complex unsafe filenames', () => {
      const unsafeFilename = '../../../secret file@#$.txt';
      const safeFilename = sanitizeFilename(unsafeFilename);
      const key = buildStorageKey('attachments', 'proj-1', 'bug-123', safeFilename);

      expect(key).toBe('attachments/proj-1/bug-123/secret_file.txt');
      expect(key).not.toContain('..');
      expect(key).not.toContain(' ');
      expect(key).not.toContain('@');
    });

    it('should handle realistic upload scenarios', () => {
      const filename = 'User Report - Issue #42.pdf';
      const safeFilename = sanitizeFilename(filename);
      const key = buildStorageKey('attachments', 'proj-5', 'bug-100', safeFilename);

      expect(key).toBe('attachments/proj-5/bug-100/User_Report_-_Issue__42.pdf');
    });
  });
});
