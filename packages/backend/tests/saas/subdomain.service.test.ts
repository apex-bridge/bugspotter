/**
 * SubdomainService Unit Tests
 * Covers slugification (including truncation edge cases), format validation,
 * reserved-name policy, cross-table availability, and unique-name generation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubdomainService } from '../../src/saas/services/subdomain.service.js';
import type { DatabaseClient } from '../../src/db/client.js';

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

interface MockOverrides {
  orgIsSubdomainAvailable?: (sd: string) => Promise<boolean>;
  requestIsReserved?: (sd: string) => Promise<boolean>;
}

function createMockDb(overrides: MockOverrides = {}) {
  const orgIsSubdomainAvailable = overrides.orgIsSubdomainAvailable ?? (async () => true);
  const requestIsReserved = overrides.requestIsReserved ?? (async () => false);
  return {
    organizations: {
      isSubdomainAvailable: vi.fn(orgIsSubdomainAvailable),
    },
    organizationRequests: {
      isSubdomainReservedByRequest: vi.fn(requestIsReserved),
    },
  } as unknown as DatabaseClient;
}

describe('SubdomainService', () => {
  let db: DatabaseClient;
  let service: SubdomainService;

  beforeEach(() => {
    db = createMockDb();
    service = new SubdomainService(db);
  });

  describe('slugify()', () => {
    it('lowercases and hyphenates a normal name', () => {
      expect(service.slugify('Acme Corp')).toBe('acme-corp');
    });

    it('collapses consecutive special chars into a single hyphen', () => {
      expect(service.slugify('Acme & Co., Ltd.')).toBe('acme-co-ltd');
    });

    it('trims leading and trailing hyphens', () => {
      expect(service.slugify('  -- Acme --  ')).toBe('acme');
    });

    it('strips non-ascii alphanumerics', () => {
      // Cyrillic → replaced by hyphens → collapsed → trimmed → empty
      expect(service.slugify('ПримерОрг')).toBe('');
    });

    it('keeps digits', () => {
      expect(service.slugify('Company 123')).toBe('company-123');
    });

    it('re-trims after truncation so the result never ends in a hyphen', () => {
      // Build a 64-char string whose 64th char is a letter, but where the
      // cut-off at char 63 lands on a hyphen.
      // Pattern: 62 a's + '-' at index 62 (so slice(0, 63) includes it) + 'b'.
      const input = 'a'.repeat(62) + '-' + 'b';
      expect(input.length).toBe(64);
      const out = service.slugify(input);
      expect(out.length).toBeLessThanOrEqual(63);
      expect(out.endsWith('-')).toBe(false);
      expect(out).toBe('a'.repeat(62));
    });

    it('returns empty string for input with no usable characters', () => {
      expect(service.slugify('!!!')).toBe('');
      expect(service.slugify('')).toBe('');
    });
  });

  describe('validateFormat()', () => {
    it('accepts valid subdomains', () => {
      expect(() => service.validateFormat('acme')).not.toThrow();
      expect(() => service.validateFormat('acme-co')).not.toThrow();
      expect(() => service.validateFormat('a1b')).not.toThrow();
    });

    it('rejects subdomains shorter than 3 characters', () => {
      expect(() => service.validateFormat('ab')).toThrow(/at least 3/);
    });

    it('rejects subdomains longer than 63 characters', () => {
      expect(() => service.validateFormat('a'.repeat(64))).toThrow(/at most 63/);
    });

    it('rejects uppercase letters', () => {
      expect(() => service.validateFormat('Acme')).toThrow(/lowercase/);
    });

    it('rejects underscores and other non-LDH characters', () => {
      expect(() => service.validateFormat('acme_co')).toThrow();
      expect(() => service.validateFormat('acme.co')).toThrow();
    });

    it('rejects leading or trailing hyphens', () => {
      expect(() => service.validateFormat('-acme')).toThrow();
      expect(() => service.validateFormat('acme-')).toThrow();
    });

    it('rejects reserved names', () => {
      expect(() => service.validateFormat('api')).toThrow(/reserved/);
      expect(() => service.validateFormat('admin')).toThrow(/reserved/);
      expect(() => service.validateFormat('signup')).toThrow(/reserved/);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when neither table holds the subdomain', async () => {
      expect(await service.isAvailable('new-co')).toBe(true);
    });

    it('returns false when organizations table already holds it', async () => {
      db = createMockDb({ orgIsSubdomainAvailable: async () => false });
      service = new SubdomainService(db);
      expect(await service.isAvailable('taken')).toBe(false);
    });

    it('returns false when a non-terminal organization request holds it', async () => {
      // Regression guard for the bug in the first PR revision, where the
      // second check called `isSubdomainTaken` (which actually queries the
      // organizations table) and never blocked a pending enterprise request.
      db = createMockDb({ requestIsReserved: async () => true });
      service = new SubdomainService(db);
      expect(await service.isAvailable('reserved-by-request')).toBe(false);
    });

    it('normalizes the input to lowercase before checking', async () => {
      const orgFn = vi.fn().mockResolvedValue(true);
      const reqFn = vi.fn().mockResolvedValue(false);
      db = {
        organizations: { isSubdomainAvailable: orgFn },
        organizationRequests: { isSubdomainReservedByRequest: reqFn },
      } as unknown as DatabaseClient;
      service = new SubdomainService(db);
      await service.isAvailable('Mixed-CASE');
      expect(orgFn).toHaveBeenCalledWith('mixed-case');
      expect(reqFn).toHaveBeenCalledWith('mixed-case');
    });
  });

  describe('generateUniqueFromName()', () => {
    it('returns the clean slug when available', async () => {
      expect(await service.generateUniqueFromName('Acme Corp')).toBe('acme-corp');
    });

    it('throws a ValidationError when the seed yields too few characters', async () => {
      await expect(service.generateUniqueFromName('!!')).rejects.toThrow(
        /Could not derive a valid subdomain/
      );
    });

    it('appends a numeric suffix on collision', async () => {
      let callCount = 0;
      const orgFn = vi.fn().mockImplementation(async () => {
        callCount++;
        // First call (base "acme-corp") collides, all subsequent return available.
        return callCount !== 1;
      });
      db = {
        organizations: { isSubdomainAvailable: orgFn },
        organizationRequests: { isSubdomainReservedByRequest: vi.fn().mockResolvedValue(false) },
      } as unknown as DatabaseClient;
      service = new SubdomainService(db);

      const result = await service.generateUniqueFromName('Acme Corp');
      expect(result).toBe('acme-corp-2');
    });

    it('skips a reserved base and falls through to suffixed attempts', async () => {
      const result = await service.generateUniqueFromName('api');
      // 'api' is reserved but 'api-2' is not and isAvailable returns true.
      expect(result).toBe('api-2');
    });

    it('throws Conflict when all suffix attempts exhaust', async () => {
      db = createMockDb({ orgIsSubdomainAvailable: async () => false });
      service = new SubdomainService(db);
      await expect(service.generateUniqueFromName('Acme Corp')).rejects.toThrow(
        /Could not generate a unique subdomain/
      );
    });

    it('handles base near the 63-char limit without producing "foo--2"', async () => {
      // Craft a base that would be exactly 63 chars ending in a letter, so
      // when we slice to make room for '-2' (3 chars), the slice boundary
      // lands at char 60. Pad so the slice boundary would be a hyphen and
      // verify we DON'T emit '--2'.
      const name = 'a'.repeat(60) + '-company'; // slugifies to "aaaa...a-company"
      // Force collision on the base so it falls into the suffix loop.
      const orgFn = vi
        .fn()
        .mockImplementationOnce(async () => false) // base collides
        .mockResolvedValue(true);
      db = {
        organizations: { isSubdomainAvailable: orgFn },
        organizationRequests: { isSubdomainReservedByRequest: vi.fn().mockResolvedValue(false) },
      } as unknown as DatabaseClient;
      service = new SubdomainService(db);

      const result = await service.generateUniqueFromName(name);
      expect(result).not.toMatch(/--/);
      expect(result.endsWith('-2')).toBe(true);
    });
  });

  describe('assertValidAndAvailable()', () => {
    it('returns normalized subdomain on happy path', async () => {
      expect(await service.assertValidAndAvailable('  AcmeCo ')).toBe('acmeco');
    });

    it('throws 400 for invalid format', async () => {
      await expect(service.assertValidAndAvailable('A_B')).rejects.toThrow();
    });

    it('throws 409 when already taken', async () => {
      db = createMockDb({ orgIsSubdomainAvailable: async () => false });
      service = new SubdomainService(db);
      await expect(service.assertValidAndAvailable('taken')).rejects.toThrow(/already taken/);
    });
  });
});
