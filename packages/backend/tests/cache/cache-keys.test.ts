/**
 * Cache Keys Tests
 */

import { describe, it, expect } from 'vitest';
import {
  buildCacheKey,
  buildCachePattern,
  CacheKeys,
  parseCacheKey,
  getCacheKeyPrefix,
} from '../../src/cache/cache-keys.js';

describe('Cache Keys', () => {
  describe('buildCacheKey', () => {
    it('should build key from multiple parts', () => {
      expect(buildCacheKey('prefix', 'id', 'sub')).toBe('prefix:id:sub');
    });

    it('should handle single part', () => {
      expect(buildCacheKey('single')).toBe('single');
    });

    it('should filter out empty parts', () => {
      expect(buildCacheKey('prefix', '', 'id')).toBe('prefix:id');
    });

    it('should handle numeric parts', () => {
      expect(buildCacheKey('prefix', 123, 'suffix')).toBe('prefix:123:suffix');
    });
  });

  describe('buildCachePattern', () => {
    it('should build pattern with wildcard', () => {
      expect(buildCachePattern('prefix')).toBe('prefix:*');
    });
  });

  describe('parseCacheKey', () => {
    it('should parse key into parts', () => {
      expect(parseCacheKey('prefix:id:sub')).toEqual(['prefix', 'id', 'sub']);
    });

    it('should handle single part', () => {
      expect(parseCacheKey('single')).toEqual(['single']);
    });
  });

  describe('getCacheKeyPrefix', () => {
    it('should return first part of key', () => {
      expect(getCacheKeyPrefix('prefix:id:sub')).toBe('prefix');
    });

    it('should return empty string for empty key', () => {
      expect(getCacheKeyPrefix('')).toBe('');
    });
  });

  describe('CacheKeys entity methods', () => {
    describe('apiKey', () => {
      it('should generate API key cache key', () => {
        expect(CacheKeys.apiKey('abc123hash')).toBe('apikey:abc123hash');
      });
    });

    describe('integrationRules', () => {
      it('should generate rules key for project', () => {
        expect(CacheKeys.integrationRules('project-1')).toBe('rules:project-1');
      });

      it('should generate rules key for project and integration', () => {
        expect(CacheKeys.integrationRules('project-1', 'integration-1')).toBe(
          'rules:project-1:integration-1'
        );
      });
    });

    describe('autoCreateRules', () => {
      it('should generate auto-create rules key', () => {
        expect(CacheKeys.autoCreateRules('project-1', 'integration-1')).toBe(
          'rules:auto:project-1:integration-1'
        );
      });
    });

    describe('projectSettings', () => {
      it('should generate project settings key', () => {
        expect(CacheKeys.projectSettings('project-1')).toBe('project:project-1');
      });
    });

    describe('systemConfig', () => {
      it('should generate system config key', () => {
        expect(CacheKeys.systemConfig('instance_settings')).toBe('sysconfig:instance_settings');
      });
    });

    describe('projectIntegration', () => {
      it('should generate project integration key', () => {
        expect(CacheKeys.projectIntegration('project-1', 'jira')).toBe(
          'integrations:project-1:jira'
        );
      });
    });

    describe('rateLimit', () => {
      it('should generate rate limit key', () => {
        expect(CacheKeys.rateLimit('key-1', 'minute')).toBe('ratelimit:key-1:minute');
      });
    });

    describe('patterns', () => {
      it('should generate API key pattern', () => {
        expect(CacheKeys.apiKeyPattern()).toBe('apikey:*');
      });

      it('should generate integration rules pattern for project', () => {
        expect(CacheKeys.integrationRulesPattern('project-1')).toBe('rules:project-1:*');
      });

      // Pin the exact output so a typo in argument order to `buildCacheKey`
      // (e.g. swapping `projectId` and `'auto'`) can't silently produce a
      // pattern that doesn't match real auto-create cache keys at runtime.
      // The shape-invariant test in cache-service.test.ts is necessary but
      // not sufficient: `startsWith(prefix)` would pass for several wrong
      // shapes that have the right components in the wrong order.
      it('should generate auto-create rules pattern for project', () => {
        expect(CacheKeys.autoCreateRulesPattern('project-1')).toBe('rules:auto:project-1:*');
      });

      it('should generate all integration rules pattern', () => {
        expect(CacheKeys.allIntegrationRulesPattern()).toBe('rules:*');
      });

      it('should generate project integration pattern', () => {
        expect(CacheKeys.projectIntegrationPattern('project-1')).toBe('integrations:project-1:*');
      });

      it('should generate rate limit pattern', () => {
        expect(CacheKeys.rateLimitPattern('key-1')).toBe('ratelimit:key-1:*');
      });
    });
  });
});
