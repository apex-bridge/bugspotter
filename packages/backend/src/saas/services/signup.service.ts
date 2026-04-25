/**
 * Signup Service
 *
 * Orchestrates self-service tenant creation: a single atomic flow that
 * provisions user + organization + trial subscription + owner membership +
 * default project + ingest-only API key for SDK write access. Separate
 * from `/auth/register` (user-only) and from the admin-approved
 * `/organization-requests` flow (kept for enterprise onboarding).
 *
 * The API key uses `PERMISSION_SCOPE.CUSTOM` with exactly
 * `['reports:write', 'sessions:write']` — least privilege for the SDK,
 * which only POSTs bug reports and session replays. Using the stock
 * `WRITE` scope would have ALSO granted `reports:read` + `sessions:read`,
 * which is dangerous for keys customers typically paste into public
 * front-end SDK code where the key ships to every page visitor.
 *
 * Atomicity: all six inserts run inside a single `db.transaction`. If any
 * step fails, nothing is committed — the user can retry without orphan
 * rows blocking the email/subdomain.
 */

import bcrypt from 'bcrypt';
import type { DatabaseClient } from '../../db/client.js';
import type { Organization, Project, User, DataResidencyRegion } from '../../db/types.js';
import {
  SUBSCRIPTION_STATUS,
  BILLING_STATUS,
  PLAN_NAME,
  ORG_MEMBER_ROLE,
  API_KEY_TYPE,
  API_KEY_AUDIT_ACTION,
  PERMISSION_SCOPE,
  DATA_RESIDENCY_REGION,
} from '../../db/types.js';
import { AppError } from '../../api/middleware/error.js';
import { PASSWORD } from '../../api/utils/constants.js';
import { getQuotaForPlan } from '../plans.js';
import { SubdomainService } from './subdomain.service.js';
import { SpamFilterService } from './spam-filter.service.js';
import {
  generatePlaintextKey,
  hashKey,
  extractKeyMetadata,
} from '../../services/api-key/key-crypto.js';
import { generateShareToken } from '../../utils/token-generator.js';
import { getLogger } from '../../logger.js';
import {
  SignupEmailService,
  type EmailLocale,
  type SendVerificationEmailParams,
} from './signup-email.service.js';

/**
 * Minimal interface so tests can pass a stub without casting through
 * `as never`. The concrete `SignupEmailService` has private fields that
 * structural mocks can't satisfy; depending on the interface keeps the
 * test API clean.
 */
export interface IVerificationEmailSender {
  sendVerificationEmail(params: SendVerificationEmailParams): Promise<boolean>;
}

const logger = getLogger();

const TRIAL_DURATION_DAYS = 14;
const DEFAULT_PROJECT_NAME = 'My First Project';
// 24-hour TTL on verification tokens. Long enough that a user can come
// back the next morning, short enough that an unread message in a
// shared inbox doesn't stay valid for weeks.
const VERIFICATION_TOKEN_TTL_HOURS = 24;

export interface SignupInput {
  email: string;
  password: string;
  name?: string;
  company_name: string;
  /** Optional user-supplied subdomain; auto-derived from company_name when omitted. */
  subdomain?: string;
  /** Client IP for rate limiting and abuse tracking. */
  ip_address: string;
  /** Honeypot field — must be empty/absent for humans. */
  honeypot?: string | null;
}

export interface SignupResult {
  user: User;
  organization: Organization;
  project: Project;
  /**
   * Plaintext API key — shown to the user ONCE on the success screen.
   * Never persisted in plaintext: the DB stores a SHA-256 hex hash only
   * (see `services/api-key/key-crypto.ts`).
   */
  api_key: string;
  api_key_id: string;
}

export class SignupService {
  private readonly subdomainService: SubdomainService;
  private readonly spamFilter: SpamFilterService;
  private readonly emailService: IVerificationEmailSender;

  constructor(
    private readonly db: DatabaseClient,
    private readonly region: DataResidencyRegion,
    /**
     * Override hook for tests — mocks the email service so unit tests
     * don't need SMTP env vars. Production wiring uses the default.
     * Typed as the narrow interface so test stubs don't need casts.
     */
    emailService?: IVerificationEmailSender
  ) {
    this.subdomainService = new SubdomainService(db);
    this.spamFilter = new SpamFilterService(db);
    this.emailService = emailService ?? new SignupEmailService();
  }

  /**
   * Build a friendly display name for verification emails. Falls back
   * to the local-part of the email, then to "there" so a missing name
   * never produces a creepy "Hi ," greeting.
   */
  private getContactNameForEmail(user: { name: string | null; email: string }): string {
    return user.name || user.email.split('@')[0] || 'there';
  }

  /**
   * Run the full signup flow. On success, every record is committed.
   * On any failure, the transaction rolls back — caller can safely retry.
   */
  async signup(input: SignupInput): Promise<SignupResult> {
    const email = input.email.toLowerCase().trim();
    const companyName = input.company_name.trim();

    if (companyName.length === 0) {
      throw new AppError('Company name is required', 400, 'ValidationError');
    }

    await this.runSpamChecks(email, companyName, input);

    const existingUser = await this.db.users.findByEmail(email);
    if (existingUser) {
      throw new AppError('User with this email already exists', 409, 'Conflict');
    }

    const subdomain = await this.resolveSubdomain(companyName, input.subdomain);

    const passwordHash = await bcrypt.hash(input.password, PASSWORD.SALT_ROUNDS);

    // Single timestamp for every row in this signup — avoids microsecond
    // drift between trial_ends_at / current_period_start / etc.
    const now = new Date();
    const trialEnd = addDays(now, TRIAL_DURATION_DAYS);

    // Generated outside the transaction so the same value is shared
    // between the in-txn DB row and the post-commit email.
    const verificationToken = generateShareToken();
    const verificationExpiresAt = addHours(now, VERIFICATION_TOKEN_TTL_HOURS);

    let result: SignupResult;
    try {
      result = await this.db.transaction(async (tx) => {
        const user = await tx.users.create({
          email,
          name: input.name?.trim() || null,
          password_hash: passwordHash,
          role: 'user',
        });

        // Insert the verification token in the same transaction as the
        // user create, so we can never end up with a user that has no
        // way to verify (and never with a token row referencing a
        // user that doesn't exist if the txn rolls back).
        await tx.emailVerificationTokens.create({
          user_id: user.id,
          token: verificationToken,
          expires_at: verificationExpiresAt,
        });

        const organization = await tx.organizations.create({
          name: companyName,
          subdomain,
          data_residency_region: this.region,
          subscription_status: SUBSCRIPTION_STATUS.TRIAL,
          trial_ends_at: trialEnd,
        });

        // Subscription row is created and committed here, but not returned
        // to the caller — the client has everything it needs via
        // `organization.trial_ends_at`. See PR #15 review.
        await tx.subscriptions.create({
          organization_id: organization.id,
          plan_name: PLAN_NAME.TRIAL,
          status: BILLING_STATUS.TRIAL,
          current_period_start: now,
          current_period_end: trialEnd,
          quotas: getQuotaForPlan(PLAN_NAME.TRIAL),
        });

        await tx.organizationMembers.create({
          organization_id: organization.id,
          user_id: user.id,
          role: ORG_MEMBER_ROLE.OWNER,
        });

        // Fresh org → project count is guaranteed 0, trial quota is 2.
        // No advisory lock needed (no concurrent project creation possible
        // on an org that doesn't exist yet outside this transaction).
        const project = await tx.projects.create({
          name: DEFAULT_PROJECT_NAME,
          created_by: user.id,
          organization_id: organization.id,
          settings: {},
        });

        const plaintextKey = generatePlaintextKey();
        const keyHash = hashKey(plaintextKey);
        const { prefix, suffix } = extractKeyMetadata(plaintextKey);

        // Ingest-only: write access to reports and sessions, NO read.
        // Intentionally narrower than PERMISSION_SCOPE.WRITE (which also
        // grants reports:read + sessions:read). SDK-embedded keys must
        // not be able to exfiltrate data — a public page would leak
        // everyone else's reports/sessions.
        const SDK_INGEST_PERMISSIONS = ['reports:write', 'sessions:write'];

        const apiKey = await tx.apiKeys.create({
          name: `${DEFAULT_PROJECT_NAME} — SDK key`,
          description: 'Auto-generated at signup — use this in your SDK init.',
          type: API_KEY_TYPE.PRODUCTION,
          permission_scope: PERMISSION_SCOPE.CUSTOM,
          permissions: SDK_INGEST_PERMISSIONS,
          allowed_projects: [project.id],
          key_hash: keyHash,
          key_prefix: prefix,
          key_suffix: suffix,
          created_by: user.id,
        });

        await tx.apiKeys.logAudit({
          api_key_id: apiKey.id,
          action: API_KEY_AUDIT_ACTION.CREATED,
          performed_by: user.id,
          changes: {
            type: apiKey.type,
            permission_scope: PERMISSION_SCOPE.CUSTOM,
            permissions: SDK_INGEST_PERMISSIONS,
            source: 'self-service-signup',
          },
        });

        return {
          user,
          organization,
          project,
          api_key: plaintextKey,
          api_key_id: apiKey.id,
        };
      });
    } catch (err) {
      // Race-condition backstop: two concurrent signups can both pass the
      // read-side checks (findByEmail / isAvailable) and both reach INSERT.
      // The UNIQUE constraints on users.email and organizations.subdomain
      // mean one will succeed, the other raises Postgres 23505. Without
      // this remap, the loser sees a 500 Internal Server Error rather than
      // the proper 409 Conflict they'd get from the read-side checks.
      const remapped = remapUniqueViolation(err);
      if (remapped) {
        throw remapped;
      }
      throw err;
    }

    // Log AFTER commit — logging inside the tx callback would record
    // success even if the COMMIT itself fails.
    logger.info('Self-service signup completed', {
      userId: result.user.id,
      organizationId: result.organization.id,
      subdomain,
      projectId: result.project.id,
    });

    // Fire-and-forget verification email. Non-blocking by design:
    // signup is "Sentry-style" — a transient SMTP outage must never
    // roll back the user's API key. The user can hit
    // /auth/resend-verification later if the email never arrives.
    void this.emailService
      .sendVerificationEmail({
        recipientEmail: result.user.email,
        contactName: this.getContactNameForEmail(result.user),
        token: verificationToken,
      })
      .catch((err) => {
        logger.error('Failed to send signup verification email (non-blocking)', {
          userId: result.user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return result;
  }

  /**
   * Consume a verification token: mark it used, set
   * `users.email_verified_at = NOW()`, return the user id.
   *
   * Returns 400 with the same generic "invalid or expired" message in
   * every failure case (unknown token, expired, already consumed,
   * consume race) so we don't leak which tokens previously existed.
   *
   * If the user was already verified via some other path (admin
   * backfill, or a stale unconsumed token surviving an unclean state),
   * we refuse to consume the token and return the same generic 400.
   * Otherwise an active token would still flip `email_verified_at`,
   * overwriting the prior verification timestamp for no reason.
   */
  async verifyEmail(rawToken: string): Promise<{ user_id: string }> {
    const token = rawToken.trim();
    if (token.length === 0) {
      throw new AppError('Invalid or expired verification token', 400, 'BadRequest');
    }

    return this.db.transaction(async (tx) => {
      const tokenRow = await tx.emailVerificationTokens.findActiveByToken(token);
      if (!tokenRow) {
        throw new AppError('Invalid or expired verification token', 400, 'BadRequest');
      }

      // Already-verified guard. Match the docstring: refuse rather
      // than re-stamp `email_verified_at`. We don't consume the
      // token in this branch — leaving it active is harmless (it'll
      // expire) and consuming silently would be a side effect with
      // no observable benefit.
      const user = await tx.users.findById(tokenRow.user_id);
      if (user?.email_verified_at) {
        throw new AppError('Invalid or expired verification token', 400, 'BadRequest');
      }

      const consumed = await tx.emailVerificationTokens.consume(tokenRow.id);
      if (!consumed) {
        // Race with another verify-email request for the same token,
        // OR the token expired in the gap between findActive and
        // consume (which now also rechecks expires_at). Same generic
        // 400 either way.
        throw new AppError('Invalid or expired verification token', 400, 'BadRequest');
      }

      await tx.users.update(tokenRow.user_id, {
        email_verified_at: new Date(),
      });

      return { user_id: tokenRow.user_id };
    });
  }

  /**
   * Issue a fresh verification token + email for a user. Called from
   * /auth/resend-verification after the user clicks "Didn't receive
   * the email?" in onboarding.
   *
   * Invalidates prior unconsumed tokens so the most recent email is
   * the only one that works — prevents an attacker who intercepted
   * an old token from using it after the user re-requests.
   *
   * Returns silently when the user is already verified; the caller
   * (route handler) treats both verified and not-yet-verified as the
   * same 200 response so we don't leak verification state.
   */
  async resendVerification(userId: string, locale?: EmailLocale): Promise<void> {
    const newToken = generateShareToken();
    const expiresAt = addHours(new Date(), VERIFICATION_TOKEN_TTL_HOURS);

    // Capture data we need for the post-commit email send. Set inside
    // the txn only when we actually issued a new token; otherwise the
    // post-commit branch below skips the send.
    let recipientEmail: string | null = null;
    let contactName = 'there';

    await this.db.transaction(async (tx) => {
      // Lock the user row for the duration of this transaction. Two
      // concurrent resend requests for the same user without this
      // lock can both invalidate prior tokens (each seeing 0 active
      // tokens) and each insert a new one — leaving the user with
      // multiple "active" tokens and breaking the "latest link is
      // the only one that works" guarantee. Adding a partial UNIQUE
      // index would make the second insert fail visibly with 500;
      // serializing here keeps both succeed-paths and last-writer
      // semantics.
      await tx.users.lockForUpdate(userId);

      const user = await tx.users.findById(userId);
      if (!user) {
        // JWT carries a user id that no longer resolves — session is
        // stale. Throw inside the txn so it rolls back cleanly.
        throw new AppError('User not found', 404, 'NotFound');
      }
      if (user.email_verified_at) {
        // Already verified — silently no-op. The route returns 200
        // in both cases so the client UI doesn't have to branch.
        return;
      }

      await tx.emailVerificationTokens.invalidateUnconsumedForUser(user.id);
      await tx.emailVerificationTokens.create({
        user_id: user.id,
        token: newToken,
        expires_at: expiresAt,
      });

      recipientEmail = user.email;
      contactName = this.getContactNameForEmail(user);
    });

    if (!recipientEmail) {
      // Already-verified branch — nothing to send.
      return;
    }

    // Fire-and-forget — same non-blocking rationale as signup.
    void this.emailService
      .sendVerificationEmail({
        recipientEmail,
        contactName,
        token: newToken,
        locale,
      })
      .catch((err) => {
        logger.error('Failed to send resend verification email (non-blocking)', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * Pre-commit spam checks. Runs before any DB writes so a bot submission
   * never consumes email/subdomain slots or triggers downstream side effects.
   *
   * Fails CLOSED: if the spam check itself errors (DB outage, connection
   * loss), refuse the signup with 503. Letting requests through during a
   * degraded state would silently disable rate-limit, honeypot, and
   * duplicate-email protections — exactly the moment abuse is most likely.
   */
  private async runSpamChecks(
    email: string,
    companyName: string,
    input: SignupInput
  ): Promise<void> {
    // Subdomain value used for SpamFilterService is informational — the real
    // uniqueness check happens via SubdomainService.assertValidAndAvailable.
    // Passing the slug here keeps the check input-complete for future rules.
    const slugForCheck = this.subdomainService.slugify(companyName) || 'pending';

    let result: Awaited<ReturnType<SpamFilterService['check']>>;
    try {
      result = await this.spamFilter.check({
        company_name: companyName,
        subdomain: slugForCheck,
        contact_email: email,
        ip_address: input.ip_address,
        honeypot: input.honeypot ?? null,
      });
    } catch (err) {
      logger.error('Spam filter check failed during signup', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new AppError('Unable to process signup at this time', 503, 'ServiceUnavailable');
    }

    if (result.rejected) {
      // `duplicate_pending` fires when SpamFilter finds an active row in
      // `organization_requests` (the enterprise admin-approved flow) for
      // this email. It's a real user state, not a bot signal — the generic
      // 403 we return for honeypot/rate-limit/etc. would leave the user with
      // no idea what to do. Map it to a clearer 409 that support can point
      // people to.
      if (result.reasons.includes('duplicate_pending')) {
        throw new AppError(
          'An enterprise signup request for this email is already in review. ' +
            'Please contact support if you need to proceed with self-service instead.',
          409,
          'PendingEnterpriseRequest'
        );
      }
      // Log the reasons server-side for ops / abuse investigation, but
      // DON'T echo them to the client — doing so leaks our spam
      // heuristics and helps bots iterate past whichever rule they
      // tripped.
      logger.info('Self-service signup rejected by spam filter', {
        ip: input.ip_address,
        reasons: result.reasons,
        score: result.spam_score,
      });
      throw new AppError('Signup request rejected', 403, 'Forbidden');
    }
  }

  /**
   * Determine the final subdomain for this tenant. User-supplied values are
   * validated and must be available; if omitted, auto-generate from the
   * company name (with numeric suffix on collision).
   */
  private async resolveSubdomain(companyName: string, userSupplied?: string): Promise<string> {
    if (userSupplied && userSupplied.trim().length > 0) {
      return this.subdomainService.assertValidAndAvailable(userSupplied);
    }
    return this.subdomainService.generateUniqueFromName(companyName);
  }
}

function addDays(base: Date, days: number): Date {
  const end = new Date(base);
  end.setDate(end.getDate() + days);
  return end;
}

function addHours(base: Date, hours: number): Date {
  const end = new Date(base);
  end.setHours(end.getHours() + hours);
  return end;
}

/**
 * Postgres unique_violation SQLSTATE. When a concurrent signup wins the
 * INSERT race, the loser's transaction raises this code.
 */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Map of the exact Postgres constraint names that this signup flow can
 * plausibly violate, to the user-facing 409 message. Using exact names
 * (rather than substring matching) keeps us from misclassifying a future
 * unique constraint — e.g. a hypothetical `users_phone_key` — as "email
 * already exists". Unknown constraints fall through to a generic message.
 *
 * The names `users_email_key` and `organizations_subdomain_key` are the
 * Postgres defaults from inline `UNIQUE` declarations on those columns
 * (see `db/migrations/001_initial_schema.sql`).
 */
const UNIQUE_CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  users_email_key: 'User with this email already exists',
  organizations_subdomain_key: 'This subdomain is already taken',
});

/**
 * If `err` is a Postgres unique_violation, return a user-facing 409 AppError
 * identifying the specific field that collided; otherwise return null so the
 * caller can rethrow the original error.
 */
function remapUniqueViolation(err: unknown): AppError | null {
  if (!err || typeof err !== 'object') {
    return null;
  }
  const candidate = err as { code?: unknown; constraint?: unknown };
  if (candidate.code !== PG_UNIQUE_VIOLATION) {
    return null;
  }

  const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : '';
  const message = UNIQUE_CONSTRAINT_MESSAGES[constraint] ?? 'A conflicting record already exists';
  return new AppError(message, 409, 'Conflict');
}

/** Resolve a region string from config into the DataResidencyRegion enum, or throw. */
export function parseDataResidencyRegion(region: string): DataResidencyRegion {
  const normalized = region.toLowerCase().trim();
  const match = (Object.values(DATA_RESIDENCY_REGION) as string[]).find((r) => r === normalized);
  if (!match) {
    throw new Error(
      `Invalid DATA_RESIDENCY_REGION: ${region}. Expected one of: ${Object.values(DATA_RESIDENCY_REGION).join(', ')}`
    );
  }
  return match as DataResidencyRegion;
}
