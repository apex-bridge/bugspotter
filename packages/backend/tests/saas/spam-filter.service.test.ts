/**
 * SpamFilterService Unit Tests
 * Covers honeypot, rate limiting, duplicate detection, disposable emails,
 * and suspicious pattern checks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpamFilterService } from '../../src/saas/services/spam-filter.service.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { signupSpamCheckTotal } from '../../src/metrics/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDb(overrides: Record<string, unknown> = {}) {
  return {
    organizationRequests: {
      countRecentByIp: vi.fn().mockResolvedValue(0),
      findPendingByEmail: vi.fn().mockResolvedValue(null),
      isSubdomainTaken: vi.fn().mockResolvedValue(false),
      ...overrides,
    },
  } as unknown as DatabaseClient;
}

function validInput() {
  return {
    company_name: 'Acme Corp',
    subdomain: 'acme',
    contact_email: 'john@acme.com',
    ip_address: '10.0.0.1',
    honeypot: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpamFilterService', () => {
  let db: DatabaseClient;
  let service: SpamFilterService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpamFilterService(db);
  });

  describe('check()', () => {
    it('should pass clean submissions', async () => {
      const result = await service.check(validInput());

      expect(result.rejected).toBe(false);
      expect(result.spam_score).toBe(0);
      expect(result.reasons).toHaveLength(0);
    });

    // ─── Honeypot ───

    it('should instantly reject when honeypot is filled', async () => {
      const result = await service.check({
        ...validInput(),
        honeypot: 'bot-filled-this',
      });

      expect(result.rejected).toBe(true);
      expect(result.spam_score).toBe(100);
      expect(result.reasons).toContain('honeypot');
    });

    it('should ignore empty honeypot', async () => {
      const result = await service.check({
        ...validInput(),
        honeypot: '',
      });

      expect(result.rejected).toBe(false);
    });

    it('should ignore whitespace-only honeypot', async () => {
      const result = await service.check({
        ...validInput(),
        honeypot: '   ',
      });

      expect(result.rejected).toBe(false);
    });

    // ─── Rate limiting ───

    it('should instantly reject when rate limit is exceeded', async () => {
      db = createMockDb({ countRecentByIp: vi.fn().mockResolvedValue(3) });
      service = new SpamFilterService(db);

      const result = await service.check(validInput());

      expect(result.rejected).toBe(true);
      expect(result.spam_score).toBe(100);
      expect(result.reasons).toContain('rate_limit');
    });

    it('should allow when under rate limit', async () => {
      db = createMockDb({ countRecentByIp: vi.fn().mockResolvedValue(2) });
      service = new SpamFilterService(db);

      const result = await service.check(validInput());

      expect(result.rejected).toBe(false);
    });

    // ─── Duplicate detection ───

    it('should instantly reject duplicate pending request', async () => {
      db = createMockDb({
        findPendingByEmail: vi.fn().mockResolvedValue({
          id: 'existing-id',
          status: 'pending_verification',
        }),
      });
      service = new SpamFilterService(db);

      const result = await service.check(validInput());

      expect(result.rejected).toBe(true);
      expect(result.spam_score).toBe(100);
      expect(result.reasons).toContain('duplicate_pending');
    });

    // ─── Disposable email ───

    it('should flag disposable email domains', async () => {
      const result = await service.check({
        ...validInput(),
        contact_email: 'user@mailinator.com',
      });

      expect(result.rejected).toBe(true);
      expect(result.spam_score).toBeGreaterThanOrEqual(50);
      expect(result.reasons).toContain('disposable_email');
    });

    it('should flag guerrillamail.com', async () => {
      const result = await service.check({
        ...validInput(),
        contact_email: 'user@guerrillamail.com',
      });

      expect(result.rejected).toBe(true);
      expect(result.reasons).toContain('disposable_email');
    });

    it('should accept normal email domains', async () => {
      const result = await service.check({
        ...validInput(),
        contact_email: 'user@company.com',
      });

      expect(result.rejected).toBe(false);
      expect(result.reasons).not.toContain('disposable_email');
    });

    // ─── Suspicious patterns ───

    it('should flag all-caps company name', async () => {
      const result = await service.check({
        ...validInput(),
        company_name: 'SPAM COMPANY NAME',
      });

      expect(result.reasons).toContain('suspicious_pattern');
      expect(result.spam_score).toBeGreaterThanOrEqual(20);
    });

    it('should not flag short all-caps names (3 chars or fewer)', async () => {
      const result = await service.check({
        ...validInput(),
        company_name: 'IBM',
      });

      expect(result.reasons).not.toContain('suspicious_pattern');
    });

    it('should flag gibberish company names with no vowels', async () => {
      const result = await service.check({
        ...validInput(),
        company_name: 'Xzktnqp Solutions',
      });

      expect(result.reasons).toContain('suspicious_pattern');
    });

    it('should not flag normal company names', async () => {
      const result = await service.check({
        ...validInput(),
        company_name: 'Acme Corporation',
      });

      expect(result.reasons).not.toContain('suspicious_pattern');
    });

    // ─── Combined scoring ───

    it('should reject when suspicious pattern + disposable email combine to >= 50', async () => {
      // all-caps = 20, disposable = 50 → total 70 → rejected
      const result = await service.check({
        ...validInput(),
        company_name: 'SPAM CORP',
        contact_email: 'x@yopmail.com',
      });

      expect(result.rejected).toBe(true);
      expect(result.spam_score).toBeGreaterThanOrEqual(50);
    });
  });

  // ─── Per-check counter semantics ───
  // The `signup_spam_check_total{check}` counter is documented as
  // a rejection-reason BREAKDOWN, not a heuristic-hit rate. A
  // request whose score-based reason fired but whose total stayed
  // below the threshold (so the request was NOT rejected) must NOT
  // increment the counter — otherwise dashboards interpreting the
  // counter as "share of rejections involving each check" would be
  // misleading.

  describe('per-check counter semantics', () => {
    let incSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      incSpy = vi.spyOn(signupSpamCheckTotal, 'inc');
    });

    afterEach(() => {
      incSpy.mockRestore();
    });

    it('does NOT increment for a sub-threshold suspicious_pattern hit', async () => {
      // 'ACME' is all-caps and >3 chars → suspicious_pattern fires
      // for +20. With no other contributors, total stays at 20 <
      // SPAM_THRESHOLD (50), so the request is NOT rejected.
      const result = await service.check({
        ...validInput(),
        company_name: 'ACME',
      });

      expect(result.rejected).toBe(false);
      expect(result.reasons).toContain('suspicious_pattern');
      expect(incSpy).not.toHaveBeenCalledWith({ check: 'suspicious_pattern' });
    });

    it('does NOT increment when no checks fire on a clean submission', async () => {
      const result = await service.check(validInput());

      expect(result.rejected).toBe(false);
      expect(incSpy).not.toHaveBeenCalled();
    });

    it('increments per reason when the score-based path actually rejects', async () => {
      // Disposable email alone: +50 score = SPAM_THRESHOLD → rejected.
      const result = await service.check({
        ...validInput(),
        contact_email: 'x@yopmail.com',
      });

      expect(result.rejected).toBe(true);
      expect(incSpy).toHaveBeenCalledWith({ check: 'disposable_email' });
    });

    it('increments multiple reasons when several score-based checks contribute to a rejection', async () => {
      // Disposable (+50) + suspicious all-caps name (+20) → 70 ≥ 50 → rejected.
      const result = await service.check({
        ...validInput(),
        company_name: 'SPAM CORP',
        contact_email: 'x@yopmail.com',
      });

      expect(result.rejected).toBe(true);
      expect(incSpy).toHaveBeenCalledWith({ check: 'disposable_email' });
      expect(incSpy).toHaveBeenCalledWith({ check: 'suspicious_pattern' });
    });

    it('increments inline for hard-reject checks (early-return paths)', async () => {
      // Honeypot: instant rejection. Counter increments inside the
      // honeypot branch, not via the post-decision loop.
      await service.check({
        ...validInput(),
        honeypot: 'spam-bot-filled-this',
      });

      expect(incSpy).toHaveBeenCalledWith({ check: 'honeypot' });
    });
  });

  // ─── Subdomain availability ───

  describe('isSubdomainAvailable()', () => {
    it('should return true when subdomain is not taken', async () => {
      const available = await service.isSubdomainAvailable('new-company');
      expect(available).toBe(true);
    });

    it('should return false when subdomain is taken', async () => {
      db = createMockDb({ isSubdomainTaken: vi.fn().mockResolvedValue(true) });
      service = new SpamFilterService(db);

      const available = await service.isSubdomainAvailable('existing');
      expect(available).toBe(false);
    });
  });
});
