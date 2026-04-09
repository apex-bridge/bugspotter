/**
 * RuleMatcher Service Tests
 * Tests for shared filtering logic used by notifications and integrations
 */

import { describe, it, expect } from 'vitest';
import { RuleMatcher, FIELD_MAP } from '../../src/services/rule-matcher.js';
import type { BugReport } from '../../src/db/types.js';
import type { FilterCondition } from '../../src/types/notifications.js';

describe('RuleMatcher', () => {
  const mockBugReport: BugReport = {
    id: 'bug-123',
    project_id: 'project-123',
    title: 'Test Bug',
    description: 'Test description',
    screenshot_url: null,
    replay_url: null,
    metadata: {
      browser: 'Chrome 120.0',
      os: 'Windows 11',
      url: 'https://example.com/checkout',
      user: {
        email: 'test@example.com',
        name: 'Test User',
      },
      console: [
        { level: 'error', message: 'NetworkError: Failed to fetch', timestamp: 1700000000000 },
        { level: 'warn', message: 'Deprecated API used', timestamp: 1700000001000 },
        { level: 'info', message: 'User logged in', timestamp: 1700000002000 },
      ],
      network: [
        {
          url: 'https://api.example.com/payment',
          method: 'POST',
          status: 500,
          statusText: 'Internal Server Error',
          duration: 1500,
          timestamp: 1700000003000,
        },
        {
          url: 'https://api.example.com/users',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          duration: 250,
          timestamp: 1700000004000,
        },
        {
          url: 'https://api.example.com/auth',
          method: 'POST',
          status: 401,
          statusText: 'Unauthorized',
          duration: 100,
          timestamp: 1700000005000,
        },
      ],
    },
    status: 'open',
    priority: 'high',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    created_at: new Date(),
    updated_at: new Date(),
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'pending',
    replay_upload_status: 'pending',
  };

  describe('matchesFilters', () => {
    it('should return true when no filters provided', () => {
      const result = RuleMatcher.matchesFilters(mockBugReport, []);
      expect(result).toBe(true);
    });

    it('should match all filters with AND logic', () => {
      const filters: FilterCondition[] = [
        { field: 'priority', operator: 'equals', value: 'high' },
        { field: 'status', operator: 'equals', value: 'open' },
      ];

      const result = RuleMatcher.matchesFilters(mockBugReport, filters);
      expect(result).toBe(true);
    });

    it('should fail if ANY filter does not match', () => {
      const filters: FilterCondition[] = [
        { field: 'priority', operator: 'equals', value: 'high' }, // matches
        { field: 'status', operator: 'equals', value: 'resolved' }, // fails
      ];

      const result = RuleMatcher.matchesFilters(mockBugReport, filters);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - equals operator', () => {
    it('should match exact value', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'equals',
        value: 'high',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match different value', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'equals',
        value: 'critical',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should be case-insensitive by default', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'equals',
        value: 'HIGH',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should respect case_sensitive flag', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'equals',
        value: 'HIGH',
        case_sensitive: true,
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - contains operator', () => {
    it('should match substring', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'contains',
        value: 'Chrome',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match non-existent substring', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'contains',
        value: 'Firefox',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should be case-insensitive by default', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'contains',
        value: 'chrome',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });
  });

  describe('matchesFilter - starts_with operator', () => {
    it('should match prefix', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'starts_with',
        value: 'Chrome',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match non-prefix', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'starts_with',
        value: '120',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - ends_with operator', () => {
    it('should match suffix', () => {
      const filter: FilterCondition = {
        field: 'os',
        operator: 'ends_with',
        value: '11',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match non-suffix', () => {
      const filter: FilterCondition = {
        field: 'os',
        operator: 'ends_with',
        value: '10',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - in operator', () => {
    it('should match value in array', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'in',
        value: ['critical', 'high', 'medium'],
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match value not in array', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'in',
        value: ['critical', 'low'],
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - not_in operator', () => {
    it('should match value not in array', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'not_in',
        value: ['critical', 'low'],
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match value in array', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'not_in',
        value: ['critical', 'high', 'medium'],
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - regex operator', () => {
    it('should match valid regex pattern', () => {
      const filter: FilterCondition = {
        field: 'url_pattern',
        operator: 'regex',
        value: '/checkout$',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match non-matching pattern', () => {
      const filter: FilterCondition = {
        field: 'url_pattern',
        operator: 'regex',
        value: '^https://another\\.com',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should handle invalid regex gracefully', () => {
      const filter: FilterCondition = {
        field: 'url_pattern',
        operator: 'regex',
        value: '[invalid(',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should be case-insensitive by default', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'regex',
        value: '^chrome',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should respect case_sensitive flag', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'regex',
        value: '^chrome',
        case_sensitive: true,
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - nested metadata fields', () => {
    it('should match nested browser field', () => {
      const filter: FilterCondition = {
        field: 'browser',
        operator: 'contains',
        value: 'Chrome',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match nested user email field', () => {
      const filter: FilterCondition = {
        field: 'user_email',
        operator: 'equals',
        value: 'test@example.com',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should return false for missing nested field', () => {
      const bugWithoutMetadata: BugReport = {
        ...mockBugReport,
        metadata: {},
      };

      const filter: FilterCondition = {
        field: 'browser',
        operator: 'equals',
        value: 'Chrome',
      };

      const result = RuleMatcher.matchesFilter(bugWithoutMetadata, filter);
      expect(result).toBe(false);
    });

    it('should return false for undefined metadata', () => {
      const bugWithoutMetadata: BugReport = {
        ...mockBugReport,
        metadata: {},
      };

      const filter: FilterCondition = {
        field: 'user_email',
        operator: 'equals',
        value: 'test@example.com',
      };

      const result = RuleMatcher.matchesFilter(bugWithoutMetadata, filter);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter - direct fields', () => {
    it('should match priority field', () => {
      const filter: FilterCondition = {
        field: 'priority',
        operator: 'equals',
        value: 'high',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match status field', () => {
      const filter: FilterCondition = {
        field: 'status',
        operator: 'equals',
        value: 'open',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match project field', () => {
      const filter: FilterCondition = {
        field: 'project',
        operator: 'equals',
        value: 'project-123',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });
  });

  describe('buildThrottleGroupKey', () => {
    it('should build error_signature key from metadata', () => {
      const bugWithErrorSig: BugReport = {
        ...mockBugReport,
        metadata: {
          error_signature: 'TypeError: Cannot read property',
        },
      };

      const key = RuleMatcher.buildThrottleGroupKey('error_signature', bugWithErrorSig);
      expect(key).toBe('error_sig:TypeError: Cannot read property');
    });

    it('should use stack_trace as fallback for error_signature', () => {
      const bugWithStackTrace: BugReport = {
        ...mockBugReport,
        metadata: {
          stack_trace: 'Error at line 42',
        },
      };

      const key = RuleMatcher.buildThrottleGroupKey('error_signature', bugWithStackTrace);
      expect(key).toBe('error_sig:Error at line 42');
    });

    it('should use bug ID as fallback for missing error_signature to prevent unrelated bugs from being grouped', () => {
      const bugWithoutError: BugReport = {
        ...mockBugReport,
        metadata: {},
      };

      const key = RuleMatcher.buildThrottleGroupKey('error_signature', bugWithoutError);
      expect(key).toBe('bug:bug-123');
    });

    it('should build project key', () => {
      const key = RuleMatcher.buildThrottleGroupKey('project', mockBugReport);
      expect(key).toBe('project:project-123');
    });

    it('should build user key from metadata', () => {
      const key = RuleMatcher.buildThrottleGroupKey('user', mockBugReport);
      expect(key).toBe('user:test@example.com');
    });

    it('should use unknown for missing user', () => {
      const bugWithoutUser: BugReport = {
        ...mockBugReport,
        metadata: {},
      };

      const key = RuleMatcher.buildThrottleGroupKey('user', bugWithoutUser);
      expect(key).toBe('user:unknown');
    });

    it('should build global key for none', () => {
      const key = RuleMatcher.buildThrottleGroupKey('none', mockBugReport);
      expect(key).toBe('global');
    });
  });

  describe('validateFilters', () => {
    it('should validate valid filters', () => {
      const filters: FilterCondition[] = [
        { field: 'priority', operator: 'equals', value: 'high' },
        { field: 'browser', operator: 'contains', value: 'Chrome' },
      ];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject invalid operator', () => {
      const filters: FilterCondition[] = [
        { field: 'priority', operator: 'invalid' as any, value: 'high' },
      ];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid operator: invalid');
    });

    it('should reject unknown field', () => {
      const filters: FilterCondition[] = [
        { field: 'unknown_field' as any, operator: 'equals', value: 'test' },
      ];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown field: unknown_field');
    });

    it('should reject non-array value for in operator', () => {
      const filters: FilterCondition[] = [{ field: 'priority', operator: 'in', value: 'high' }];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Operator in requires array value');
    });

    it('should reject non-array value for not_in operator', () => {
      const filters: FilterCondition[] = [{ field: 'priority', operator: 'not_in', value: 'high' }];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Operator not_in requires array value');
    });

    it('should reject invalid regex pattern', () => {
      const filters: FilterCondition[] = [
        { field: 'url_pattern', operator: 'regex', value: '[invalid(' },
      ];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid regex pattern');
    });

    it('should collect multiple errors', () => {
      const filters: FilterCondition[] = [
        { field: 'unknown' as any, operator: 'equals', value: 'test' },
        { field: 'priority', operator: 'invalid' as any, value: 'high' },
        { field: 'status', operator: 'in', value: 'open' },
      ];

      const result = RuleMatcher.validateFilters(filters);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('FIELD_MAP', () => {
    it('should export FIELD_MAP constant', () => {
      expect(FIELD_MAP).toBeDefined();
      expect(FIELD_MAP.priority).toBe('priority');
      expect(FIELD_MAP.browser).toBe('metadata.browser');
      expect(FIELD_MAP.user_email).toBe('metadata.user.email');
    });

    it('should have all required fields', () => {
      const requiredFields = [
        'project',
        'browser',
        'os',
        'url_pattern',
        'user_email',
        'error_message',
        'priority',
        'status',
        'console_level',
        'console_message',
        'network_status',
        'network_url',
      ];

      for (const field of requiredFields) {
        expect(FIELD_MAP[field]).toBeDefined();
      }
    });
  });

  describe('Array Field Filtering - Console Logs', () => {
    it('should match console_level with equals operator', () => {
      const filter: FilterCondition = {
        field: 'console_level',
        operator: 'equals',
        value: 'error',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match console_level with in operator', () => {
      const filter: FilterCondition = {
        field: 'console_level',
        operator: 'in',
        value: ['error', 'warn'],
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match console_level when level does not exist', () => {
      const filter: FilterCondition = {
        field: 'console_level',
        operator: 'equals',
        value: 'debug',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should match console_message with contains operator', () => {
      const filter: FilterCondition = {
        field: 'console_message',
        operator: 'contains',
        value: 'NetworkError',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match console_message with regex operator', () => {
      const filter: FilterCondition = {
        field: 'console_message',
        operator: 'regex',
        value: 'Failed|timeout',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match console_message case-insensitively by default', () => {
      const filter: FilterCondition = {
        field: 'console_message',
        operator: 'contains',
        value: 'NETWORKERROR',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should respect case_sensitive flag for console_message', () => {
      const filter: FilterCondition = {
        field: 'console_message',
        operator: 'contains',
        value: 'NETWORKERROR',
        case_sensitive: true,
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should not match console_message when message does not contain value', () => {
      const filter: FilterCondition = {
        field: 'console_message',
        operator: 'contains',
        value: 'SomethingThatDoesNotExist',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should return false when console array is empty', () => {
      const bugWithoutConsole = {
        ...mockBugReport,
        metadata: {
          ...mockBugReport.metadata,
          console: [],
        },
      };

      const filter: FilterCondition = {
        field: 'console_level',
        operator: 'equals',
        value: 'error',
      };

      const result = RuleMatcher.matchesFilter(bugWithoutConsole, filter);
      expect(result).toBe(false);
    });

    it('should return false when console array is missing', () => {
      const bugWithoutConsole = {
        ...mockBugReport,
        metadata: {
          browser: mockBugReport.metadata?.browser,
          os: mockBugReport.metadata?.os,
        },
      };

      const filter: FilterCondition = {
        field: 'console_level',
        operator: 'equals',
        value: 'error',
      };

      const result = RuleMatcher.matchesFilter(bugWithoutConsole, filter);
      expect(result).toBe(false);
    });
  });

  describe('Array Field Filtering - Network Requests', () => {
    it('should match network_status with equals operator', () => {
      const filter: FilterCondition = {
        field: 'network_status',
        operator: 'equals',
        value: '500',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match network_status with in operator for error codes', () => {
      const filter: FilterCondition = {
        field: 'network_status',
        operator: 'in',
        value: ['500', '502', '503'],
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match network_status for 4xx errors', () => {
      const filter: FilterCondition = {
        field: 'network_status',
        operator: 'equals',
        value: '401',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match network_status when status does not exist', () => {
      const filter: FilterCondition = {
        field: 'network_status',
        operator: 'equals',
        value: '404',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should match network_url with contains operator', () => {
      const filter: FilterCondition = {
        field: 'network_url',
        operator: 'contains',
        value: '/payment',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match network_url with starts_with operator', () => {
      const filter: FilterCondition = {
        field: 'network_url',
        operator: 'starts_with',
        value: 'https://api.example.com',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should match network_url with regex operator', () => {
      const filter: FilterCondition = {
        field: 'network_url',
        operator: 'regex',
        value: '/payment|/checkout',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(true);
    });

    it('should not match network_url when URL does not contain value', () => {
      const filter: FilterCondition = {
        field: 'network_url',
        operator: 'contains',
        value: '/nonexistent',
      };

      const result = RuleMatcher.matchesFilter(mockBugReport, filter);
      expect(result).toBe(false);
    });

    it('should return false when network array is empty', () => {
      const bugWithoutNetwork = {
        ...mockBugReport,
        metadata: {
          ...mockBugReport.metadata,
          network: [],
        },
      };

      const filter: FilterCondition = {
        field: 'network_status',
        operator: 'equals',
        value: '500',
      };

      const result = RuleMatcher.matchesFilter(bugWithoutNetwork, filter);
      expect(result).toBe(false);
    });

    it('should return false when network array is missing', () => {
      const bugWithoutNetwork = {
        ...mockBugReport,
        metadata: {
          browser: mockBugReport.metadata?.browser,
          os: mockBugReport.metadata?.os,
        },
      };

      const filter: FilterCondition = {
        field: 'network_url',
        operator: 'contains',
        value: '/payment',
      };

      const result = RuleMatcher.matchesFilter(bugWithoutNetwork, filter);
      expect(result).toBe(false);
    });
  });

  describe('Complex Array Filtering Scenarios', () => {
    it('should match multiple console and network filters together', () => {
      const filters: FilterCondition[] = [
        { field: 'console_level', operator: 'equals', value: 'error' },
        { field: 'network_status', operator: 'equals', value: '500' },
        { field: 'priority', operator: 'equals', value: 'high' },
      ];

      const result = RuleMatcher.matchesFilters(mockBugReport, filters);
      expect(result).toBe(true);
    });

    it('should fail when one array filter does not match', () => {
      const filters: FilterCondition[] = [
        { field: 'console_level', operator: 'equals', value: 'error' }, // matches
        { field: 'network_status', operator: 'equals', value: '404' }, // does not match
      ];

      const result = RuleMatcher.matchesFilters(mockBugReport, filters);
      expect(result).toBe(false);
    });

    it('should handle combination of standard and array filters', () => {
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'contains', value: 'Chrome' },
        { field: 'console_message', operator: 'contains', value: 'NetworkError' },
        { field: 'network_url', operator: 'contains', value: '/payment' },
      ];

      const result = RuleMatcher.matchesFilters(mockBugReport, filters);
      expect(result).toBe(true);
    });
  });
});
