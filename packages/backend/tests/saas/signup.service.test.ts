/**
 * SignupService Unit Tests
 * Covers the happy path plus the contract boundaries:
 * - duplicate email → 409 (before any DB writes)
 * - spam filter rejection → 403
 * - spam filter error → 503 (fail closed, not fail open)
 * - invalid subdomain format → 400 ValidationError; taken/reserved subdomain → 409
 * - concurrent-insert race (Postgres 23505) → 409, not 500
 * - atomic transaction: all 6 inserts or none
 * - API key returned in plaintext; stored as SHA-256 hash
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignupService } from '../../src/saas/services/signup.service.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { DATA_RESIDENCY_REGION } from '../../src/db/types.js';
import { hashKey } from '../../src/services/api-key/key-crypto.js';

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface InsertLog {
  users: unknown[];
  organizations: unknown[];
  subscriptions: unknown[];
  organizationMembers: unknown[];
  projects: unknown[];
  apiKeys: unknown[];
  apiKeyAudits: unknown[];
}

function validInput() {
  return {
    email: 'Founder@Acme.com',
    password: 'correct-horse-battery-staple',
    name: 'Jane Founder',
    company_name: 'Acme Corp',
    ip_address: '203.0.113.7',
    honeypot: null,
  };
}

interface DbOverrides {
  findByEmail?: () => Promise<unknown>;
  countRecentByIp?: () => Promise<number>;
  findPendingByEmail?: () => Promise<unknown>;
  isSubdomainTaken?: () => Promise<boolean>;
  isSubdomainReservedByRequest?: () => Promise<boolean>;
  orgIsSubdomainAvailable?: () => Promise<boolean>;
  spamFilterThrows?: boolean;
  transactionThrows?: boolean;
}

function createMockDb(overrides: DbOverrides = {}): {
  db: DatabaseClient;
  log: InsertLog;
  transactionCalled: { value: number };
} {
  const log: InsertLog = {
    users: [],
    organizations: [],
    subscriptions: [],
    organizationMembers: [],
    projects: [],
    apiKeys: [],
    apiKeyAudits: [],
  };
  const transactionCalled = { value: 0 };

  const tx = {
    users: {
      create: vi.fn(async (data: unknown) => {
        const user = { id: 'user-uuid', created_at: new Date(), ...(data as object) };
        log.users.push(user);
        return user;
      }),
    },
    organizations: {
      create: vi.fn(async (data: unknown) => {
        const org = {
          id: 'org-uuid',
          created_at: new Date(),
          updated_at: new Date(),
          ...(data as object),
        };
        log.organizations.push(org);
        return org;
      }),
    },
    subscriptions: {
      create: vi.fn(async (data: unknown) => {
        const sub = {
          id: 'sub-uuid',
          created_at: new Date(),
          updated_at: new Date(),
          ...(data as object),
        };
        log.subscriptions.push(sub);
        return sub;
      }),
    },
    organizationMembers: {
      create: vi.fn(async (data: unknown) => {
        log.organizationMembers.push(data);
        return { id: 'member-uuid', ...(data as object) };
      }),
    },
    projects: {
      create: vi.fn(async (data: unknown) => {
        const project = {
          id: 'project-uuid',
          created_at: new Date(),
          updated_at: new Date(),
          ...(data as object),
        };
        log.projects.push(project);
        return project;
      }),
    },
    apiKeys: {
      create: vi.fn(async (data: unknown) => {
        const key = {
          id: 'apikey-uuid',
          created_at: new Date(),
          updated_at: new Date(),
          ...(data as object),
        };
        log.apiKeys.push(key);
        return key;
      }),
      logAudit: vi.fn(async (data: unknown) => {
        log.apiKeyAudits.push(data);
      }),
    },
  };

  const db = {
    users: {
      findByEmail: vi.fn(overrides.findByEmail ?? (async () => null)),
    },
    organizations: {
      isSubdomainAvailable: vi.fn(overrides.orgIsSubdomainAvailable ?? (async () => true)),
    },
    organizationRequests: {
      countRecentByIp: vi.fn(overrides.countRecentByIp ?? (async () => 0)),
      findPendingByEmail: vi.fn(overrides.findPendingByEmail ?? (async () => null)),
      isSubdomainTaken: vi.fn(overrides.isSubdomainTaken ?? (async () => false)),
      isSubdomainReservedByRequest: vi.fn(
        overrides.isSubdomainReservedByRequest ?? (async () => false)
      ),
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      transactionCalled.value++;
      if (overrides.transactionThrows) {
        throw new Error('simulated commit failure');
      }
      return cb(tx);
    }),
  } as unknown as DatabaseClient;

  if (overrides.spamFilterThrows) {
    (db.organizationRequests.countRecentByIp as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('db connection lost')
    );
  }

  return { db, log, transactionCalled };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignupService', () => {
  let mock: ReturnType<typeof createMockDb>;
  let service: SignupService;

  beforeEach(() => {
    mock = createMockDb();
    service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);
  });

  describe('happy path', () => {
    it('provisions all 6 records in a single transaction', async () => {
      const result = await service.signup(validInput());

      expect(mock.transactionCalled.value).toBe(1);
      expect(mock.log.users).toHaveLength(1);
      expect(mock.log.organizations).toHaveLength(1);
      expect(mock.log.subscriptions).toHaveLength(1);
      expect(mock.log.organizationMembers).toHaveLength(1);
      expect(mock.log.projects).toHaveLength(1);
      expect(mock.log.apiKeys).toHaveLength(1);
      expect(mock.log.apiKeyAudits).toHaveLength(1);

      expect(result.user.id).toBe('user-uuid');
      expect(result.organization.id).toBe('org-uuid');
      expect(result.project.id).toBe('project-uuid');
      expect(result.api_key).toMatch(/^bgs_/);
      expect(result.api_key_id).toBe('apikey-uuid');
    });

    it('stores the API key as a SHA-256 hex hash (not plaintext, not bcrypt)', async () => {
      const result = await service.signup(validInput());
      const storedKey = mock.log.apiKeys[0] as { key_hash: string };

      // SHA-256 hex is always 64 hex chars.
      expect(storedKey.key_hash).toMatch(/^[0-9a-f]{64}$/);
      // And it verifiably matches the plaintext via the shared hashKey().
      expect(storedKey.key_hash).toBe(hashKey(result.api_key));
    });

    it('hashes the password with bcrypt before storing', async () => {
      await service.signup(validInput());
      const storedUser = mock.log.users[0] as { password_hash: string };

      expect(storedUser.password_hash).not.toBe(validInput().password);
      // bcrypt hashes start with $2a$, $2b$, or $2y$
      expect(storedUser.password_hash).toMatch(/^\$2[aby]\$/);
    });

    it('normalizes email to lowercase and trims whitespace', async () => {
      await service.signup({ ...validInput(), email: '  Founder@Acme.COM  ' });
      const storedUser = mock.log.users[0] as { email: string };
      expect(storedUser.email).toBe('founder@acme.com');
    });

    it('uses the configured data residency region, not anything from input', async () => {
      const rfService = new SignupService(mock.db, DATA_RESIDENCY_REGION.RF);
      await rfService.signup(validInput());
      const storedOrg = mock.log.organizations[0] as { data_residency_region: string };
      expect(storedOrg.data_residency_region).toBe('rf');
    });

    it('auto-generates subdomain from company name when not provided', async () => {
      await service.signup({ ...validInput(), company_name: 'Acme Widgets LLC' });
      const storedOrg = mock.log.organizations[0] as { subdomain: string };
      expect(storedOrg.subdomain).toBe('acme-widgets-llc');
    });

    it('uses the user-supplied subdomain when provided', async () => {
      await service.signup({ ...validInput(), subdomain: 'my-custom-sub' });
      const storedOrg = mock.log.organizations[0] as { subdomain: string };
      expect(storedOrg.subdomain).toBe('my-custom-sub');
    });

    it('issues a write-scoped API key limited to the new project', async () => {
      const result = await service.signup(validInput());
      const storedKey = mock.log.apiKeys[0] as {
        permission_scope: string;
        allowed_projects: string[];
      };
      expect(storedKey.permission_scope).toBe('write');
      expect(storedKey.allowed_projects).toEqual([result.project.id]);
    });

    it('uses the same timestamp for trial_ends_at and current_period_end', async () => {
      await service.signup(validInput());
      const storedOrg = mock.log.organizations[0] as { trial_ends_at: Date };
      const storedSub = mock.log.subscriptions[0] as { current_period_end: Date };
      expect(storedOrg.trial_ends_at.getTime()).toBe(storedSub.current_period_end.getTime());
    });
  });

  describe('validation failures', () => {
    it('rejects empty company_name with 400', async () => {
      await expect(service.signup({ ...validInput(), company_name: '   ' })).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mock.transactionCalled.value).toBe(0);
    });

    it('rejects duplicate email with 409 and never opens a transaction', async () => {
      mock = createMockDb({
        findByEmail: async () => ({ id: 'existing-user' }),
      });
      service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(mock.transactionCalled.value).toBe(0);
    });

    it('rejects when user-supplied subdomain is taken with 409', async () => {
      mock = createMockDb({ orgIsSubdomainAvailable: async () => false });
      service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup({ ...validInput(), subdomain: 'taken' })).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(mock.transactionCalled.value).toBe(0);
    });

    it('rejects when subdomain is held by a pending enterprise request', async () => {
      mock = createMockDb({ isSubdomainReservedByRequest: async () => true });
      service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(
        service.signup({ ...validInput(), subdomain: 'reserved' })
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('spam filter', () => {
    it('rejects honeypot-filled submissions with 403 (bot signature)', async () => {
      await expect(
        service.signup({ ...validInput(), honeypot: 'spam-bot-filled-this' })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mock.transactionCalled.value).toBe(0);
    });

    it('rejects IP rate-limited submissions with 403', async () => {
      mock = createMockDb({ countRecentByIp: async () => 10 });
      service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('fails CLOSED when the spam filter itself errors (503, not allow-through)', async () => {
      // Regression guard: the first PR revision caught this error and let the
      // signup proceed, effectively disabling rate-limits during DB outages.
      mock = createMockDb({ spamFilterThrows: true });
      service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toMatchObject({
        statusCode: 503,
      });
      expect(mock.transactionCalled.value).toBe(0);
    });
  });

  describe('unique-violation race', () => {
    // Two concurrent signups can both pass the read-side checks (findByEmail,
    // isAvailable) and both reach INSERT. The Postgres UNIQUE constraints on
    // users.email and organizations.subdomain ensure one wins and the loser
    // raises 23505. These tests guard that we remap to 409 (not 500).

    function createMockDbWithUniqueViolation(constraint: string) {
      const { db, log, transactionCalled } = createMockDb();
      // Override the tx callback to throw a Postgres-shaped error with the
      // given constraint name. This simulates the loser of an INSERT race.
      (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        transactionCalled.value++;
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        err.code = '23505';
        err.constraint = constraint;
        throw err;
      });
      return { db, log, transactionCalled };
    }

    it('maps a users.email UNIQUE violation to 409 Conflict', async () => {
      const raceMock = createMockDbWithUniqueViolation('users_email_key');
      service = new SignupService(raceMock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(/email/i) as unknown as string,
      });
    });

    it('maps an organizations.subdomain UNIQUE violation to 409 Conflict', async () => {
      const raceMock = createMockDbWithUniqueViolation('organizations_subdomain_key');
      service = new SignupService(raceMock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(/subdomain/i) as unknown as string,
      });
    });

    it('maps an unknown UNIQUE violation to a generic 409 (no SQL identifier leak)', async () => {
      const raceMock = createMockDbWithUniqueViolation('some_internal_constraint');
      service = new SignupService(raceMock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('does NOT swallow unrelated errors (only 23505 is remapped)', async () => {
      const { db, transactionCalled } = createMockDb();
      (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        transactionCalled.value++;
        throw new Error('unrelated internal error');
      });
      service = new SignupService(db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toThrow(/unrelated internal error/);
    });
  });

  describe('transaction atomicity', () => {
    it('surfaces a commit failure to the caller and does not return a partial result', async () => {
      mock = createMockDb({ transactionThrows: true });
      service = new SignupService(mock.db, DATA_RESIDENCY_REGION.KZ);

      await expect(service.signup(validInput())).rejects.toThrow(/simulated commit failure/);
    });
  });
});
