/**
 * Linear Client Tests
 *
 * Focused on the pure helpers exposed via `__test`. Full GraphQL
 * roundtrip tests would require mocking `https.request` + DNS resolution
 * — left to integration/E2E tests where they're cheaper to maintain.
 */

import { describe, it, expect } from 'vitest';
import { LinearClient, __test } from '../../../src/integrations/linear/client.js';

describe('LinearClient constructor', () => {
  it('rejects empty API key', () => {
    expect(() => new LinearClient('')).toThrow(/required/i);
    expect(() => new LinearClient('   ')).toThrow(/required/i);
  });

  it('trims the API key', () => {
    // No public accessor; we just verify it doesn't throw with whitespace.
    expect(() => new LinearClient('  lin_api_xxx  ')).not.toThrow();
  });
});

describe('parseRetryAfter', () => {
  const { parseRetryAfter } = __test;

  it('parses integer seconds into milliseconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date format relative to now', () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('garbage')).toBeUndefined();
  });

  it('takes first value when given an array header', () => {
    expect(parseRetryAfter(['10', '20'])).toBe(10_000);
  });
});

describe('formatGraphQLError', () => {
  const { formatGraphQLError } = __test;

  it('prefers userPresentableMessage when present', () => {
    const out = formatGraphQLError([
      {
        message: 'Internal',
        extensions: { userPresentableMessage: 'You lack permission' },
      },
    ]);
    expect(out).toBe('You lack permission');
  });

  it('falls back to message when userPresentableMessage is missing', () => {
    const out = formatGraphQLError([{ message: 'GraphQL error' }]);
    expect(out).toBe('GraphQL error');
  });

  it('joins multiple errors with a separator', () => {
    const out = formatGraphQLError([{ message: 'First' }, { message: 'Second' }]);
    expect(out).toBe('First; Second');
  });
});

describe('LinearClient.getIssueUrl', () => {
  it('builds a fallback issue URL from org urlKey and identifier', () => {
    const url = LinearClient.getIssueUrl('acme', 'ENG-42');
    expect(url).toBe('https://linear.app/acme/issue/ENG-42');
  });
});
