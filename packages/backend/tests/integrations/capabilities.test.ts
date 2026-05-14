/**
 * Unit tests for the platform-neutral capability interface.
 *
 * These cover the small bits that don't touch HTTP:
 *   - `pluginSupports()` runtime check (duck-typed)
 *   - `isCanonicalStatus()` type guard
 *   - `isTerminalStatus()` predicate used by auto-reopen
 *
 * Per-plugin status mappers (Jira / Linear) have their own test files.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_STATUSES,
  isCanonicalStatus,
  isTerminalStatus,
  pluginSupports,
} from '../../src/integrations/capabilities.js';

describe('capabilities — CanonicalStatus helpers', () => {
  describe('CANONICAL_STATUSES', () => {
    it('contains exactly the four canonical values', () => {
      expect(CANONICAL_STATUSES).toEqual(['open', 'in_progress', 'closed', 'wont_fix']);
    });
  });

  describe('isCanonicalStatus', () => {
    it('accepts the canonical values', () => {
      for (const s of CANONICAL_STATUSES) {
        expect(isCanonicalStatus(s)).toBe(true);
      }
    });

    it('rejects unknown strings', () => {
      expect(isCanonicalStatus('done')).toBe(false);
      expect(isCanonicalStatus('todo')).toBe(false);
      expect(isCanonicalStatus('')).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isCanonicalStatus(null)).toBe(false);
      expect(isCanonicalStatus(undefined)).toBe(false);
      expect(isCanonicalStatus(0)).toBe(false);
      expect(isCanonicalStatus({})).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('marks closed and wont_fix as terminal', () => {
      expect(isTerminalStatus('closed')).toBe(true);
      expect(isTerminalStatus('wont_fix')).toBe(true);
    });

    it('marks open and in_progress as non-terminal', () => {
      expect(isTerminalStatus('open')).toBe(false);
      expect(isTerminalStatus('in_progress')).toBe(false);
    });
  });
});

describe('capabilities — pluginSupports', () => {
  // Minimal stand-in for an IntegrationService — only the bits that matter
  // for capability detection. We cast through unknown to avoid having to
  // implement the entire interface for these tests.
  const stub = (extras: Record<string, unknown>) =>
    ({
      platform: 'jira',
      createFromBugReport: async () => ({ externalId: 'X', externalUrl: 'u' }),
      testConnection: async () => true,
      validateConfig: async () => ({ valid: true }),
      ...extras,
    }) as never;

  it('returns false for null / undefined services', () => {
    expect(pluginSupports(null, 'addComment')).toBe(false);
    expect(pluginSupports(undefined, 'addComment')).toBe(false);
  });

  it('returns false when the capability method is absent', () => {
    const s = stub({});
    expect(pluginSupports(s, 'addComment')).toBe(false);
    expect(pluginSupports(s, 'transition')).toBe(false);
    expect(pluginSupports(s, 'getStatus')).toBe(false);
  });

  it('returns true when the capability method is a function', () => {
    const s = stub({
      addComment: async () => undefined,
      getStatus: async () => 'open',
    });
    expect(pluginSupports(s, 'addComment')).toBe(true);
    expect(pluginSupports(s, 'getStatus')).toBe(true);
    expect(pluginSupports(s, 'transition')).toBe(false);
  });

  it('returns false when the property exists but is not a function', () => {
    // Defensive — plugins loaded from filesystem/database could in principle
    // ship a `transition: 'yes'` literal. We accept only callable.
    const s = stub({ transition: 'yes' });
    expect(pluginSupports(s, 'transition')).toBe(false);
  });
});
