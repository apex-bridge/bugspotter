/**
 * Spam Filter Service
 * Server-side anti-abuse checks for organization registration requests.
 * Each check contributes to a cumulative spam_score; requests scoring >= 50
 * are auto-rejected. Some checks cause instant rejection (score 100).
 */

import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';
import { signupSpamCheckTotal } from '../../metrics/registry.js';
import { DISPOSABLE_EMAIL_DOMAINS } from '../data/disposable-email-domains.js';

const logger = getLogger();

/** Score threshold — requests at or above this are considered spam */
const SPAM_THRESHOLD = 50;

/** Rate limit: max requests per IP within the window */
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MINUTES = 60;

export interface SpamCheckInput {
  company_name: string;
  subdomain: string;
  contact_email: string;
  ip_address: string;
  honeypot?: string | null;
}

export interface SpamCheckResult {
  rejected: boolean;
  spam_score: number;
  reasons: string[];
}

export class SpamFilterService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Run all spam checks against a submission.
   * Returns the aggregate result with score and reasons.
   */
  async check(input: SpamCheckInput): Promise<SpamCheckResult> {
    let score = 0;
    const reasons: string[] = [];

    // 1. Honeypot — instant reject
    if (input.honeypot && input.honeypot.trim().length > 0) {
      signupSpamCheckTotal.inc({ check: 'honeypot' });
      logger.info('Spam check: honeypot triggered', { ip: input.ip_address });
      return { rejected: true, spam_score: 100, reasons: ['honeypot'] };
    }

    // 2. Rate limit — instant reject
    const recentCount = await this.db.organizationRequests.countRecentByIp(
      input.ip_address,
      RATE_LIMIT_WINDOW_MINUTES
    );
    if (recentCount >= RATE_LIMIT_MAX) {
      signupSpamCheckTotal.inc({ check: 'rate_limit' });
      logger.info('Spam check: rate limit exceeded', {
        ip: input.ip_address,
        count: recentCount,
      });
      return { rejected: true, spam_score: 100, reasons: ['rate_limit'] };
    }

    // 3. Duplicate pending request — instant reject
    const existing = await this.db.organizationRequests.findPendingByEmail(input.contact_email);
    if (existing) {
      signupSpamCheckTotal.inc({ check: 'duplicate_pending' });
      logger.info('Spam check: duplicate pending request', {
        email: input.contact_email,
        existingId: existing.id,
      });
      return { rejected: true, spam_score: 100, reasons: ['duplicate_pending'] };
    }

    // 4. Disposable email domain
    const emailDomain = input.contact_email.split('@')[1]?.toLowerCase();
    if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
      score += 50;
      reasons.push('disposable_email');
      signupSpamCheckTotal.inc({ check: 'disposable_email' });
      logger.info('Spam check: disposable email detected', { domain: emailDomain });
    }

    // 5. Suspicious patterns
    const suspiciousScore = this.checkSuspiciousPatterns(input.company_name);
    if (suspiciousScore > 0) {
      score += suspiciousScore;
      reasons.push('suspicious_pattern');
      signupSpamCheckTotal.inc({ check: 'suspicious_pattern' });
    }

    const rejected = score >= SPAM_THRESHOLD;
    if (rejected) {
      logger.info('Spam check: request rejected', {
        score,
        reasons,
        email: input.contact_email,
      });
    }

    return { rejected, spam_score: score, reasons };
  }

  /**
   * Check for suspicious patterns in the company name.
   * Returns a score contribution (0 = clean).
   */
  private checkSuspiciousPatterns(companyName: string): number {
    let score = 0;

    // All-caps company name (more than 3 chars)
    if (companyName.length > 3 && companyName === companyName.toUpperCase()) {
      score += 20;
    }

    // Gibberish detection: mostly consonants, no vowels in long words
    const words = companyName.split(/\s+/);
    for (const word of words) {
      if (word.length >= 6) {
        const vowelCount = (word.match(/[aeiouAEIOU]/g) || []).length;
        const vowelRatio = vowelCount / word.length;
        if (vowelRatio < 0.15) {
          score += 20;
          break;
        }
      }
    }

    return score;
  }

  /**
   * Validate that the requested subdomain is not already taken.
   * This is a validation error (400), not a spam check.
   */
  async isSubdomainAvailable(subdomain: string): Promise<boolean> {
    return !(await this.db.organizationRequests.isSubdomainTaken(subdomain));
  }
}
