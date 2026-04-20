/**
 * Signup Service
 *
 * Orchestrates self-service tenant creation: a single atomic flow that
 * provisions user + organization + trial subscription + owner membership +
 * default project + write-scoped API key for SDK ingestion. Separate from
 * `/auth/register` (user-only) and from the admin-approved
 * `/organization-requests` flow (kept for enterprise onboarding).
 *
 * The API key uses `PERMISSION_SCOPE.WRITE` (reports:read/write +
 * sessions:read/write) — the minimum the SDK needs to post reports and
 * session replays. There is no dedicated `ingest` scope in the
 * permission enum; adding one would require a DB CHECK-constraint
 * migration and is out of scope here.
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
import { resolvePermissions } from '../../services/api-key/key-permissions.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

const TRIAL_DURATION_DAYS = 14;
const DEFAULT_PROJECT_NAME = 'My First Project';

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

  constructor(
    private readonly db: DatabaseClient,
    private readonly region: DataResidencyRegion
  ) {
    this.subdomainService = new SubdomainService(db);
    this.spamFilter = new SpamFilterService(db);
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

    let result;
    try {
      result = await this.db.transaction(async (tx) => {
        const user = await tx.users.create({
          email,
          name: input.name?.trim() || null,
          password_hash: passwordHash,
          role: 'user',
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
        const scope = PERMISSION_SCOPE.WRITE;

        const apiKey = await tx.apiKeys.create({
          name: `${DEFAULT_PROJECT_NAME} — SDK key`,
          description: 'Auto-generated at signup — use this in your SDK init.',
          type: API_KEY_TYPE.PRODUCTION,
          permission_scope: scope,
          permissions: resolvePermissions(scope),
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
            permission_scope: scope,
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

    return result;
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

    let result;
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
      throw new AppError('Signup request rejected', 403, 'Forbidden', {
        reasons: result.reasons,
      });
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
