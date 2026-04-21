/**
 * OrganizationService — retention-window hard-delete tests.
 *
 * Covers the new `listPendingHardDelete` and `hardDeleteExpired` paths
 * added for the platform-admin retention UI. Pure unit — mocks the
 * database client, no Postgres / testcontainers dependency.
 *
 * The broader OrganizationService integration tests live in
 * `tests/saas/organization.service.test.ts` (real DB via testcontainers);
 * this file narrowly covers the retention logic so the window-guard and
 * audit semantics are pinned down without a DB.
 */

import { describe, it, expect, vi } from 'vitest';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import type { DatabaseClient } from '../../src/db/client.js';

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

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

interface MockDbOverrides {
  findByIdIncludeDeleted?: () => Promise<unknown>;
  findExpiredSoftDeleted?: () => Promise<unknown[]>;
  hardDeleteExpiredSoftDeleted?: () => Promise<boolean>;
  countByOrganizationId?: () => Promise<number>;
  countBugReportsByOrganizationId?: () => Promise<number>;
  transactionThrows?: Error;
}

function createMockDb(overrides: MockDbOverrides = {}): {
  db: DatabaseClient;
  log: { auditCreated: unknown[]; hardDeleted: string[] };
} {
  const log: { auditCreated: unknown[]; hardDeleted: string[] } = {
    auditCreated: [],
    hardDeleted: [],
  };

  const tx = {
    auditLogs: {
      create: vi.fn(async (data: unknown) => {
        log.auditCreated.push(data);
        return { id: 'audit-uuid' };
      }),
    },
    organizations: {
      hardDeleteExpiredSoftDeleted: vi.fn(
        overrides.hardDeleteExpiredSoftDeleted ??
          (async (id: string) => {
            log.hardDeleted.push(id);
            return true;
          })
      ),
    },
  };

  return {
    log,
    db: {
      organizations: {
        findByIdIncludeDeleted: vi.fn(overrides.findByIdIncludeDeleted ?? (async () => null)),
        findExpiredSoftDeleted: vi.fn(overrides.findExpiredSoftDeleted ?? (async () => [])),
      },
      projects: {
        countByOrganizationId: vi.fn(overrides.countByOrganizationId ?? (async () => 0)),
      },
      bugReports: {
        countByOrganizationId: vi.fn(overrides.countBugReportsByOrganizationId ?? (async () => 0)),
      },
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        if (overrides.transactionThrows) {
          throw overrides.transactionThrows;
        }
        return cb(tx);
      }),
    } as unknown as DatabaseClient,
  };
}

// ---------------------------------------------------------------------------
// listPendingHardDelete
// ---------------------------------------------------------------------------

describe('OrganizationService.listPendingHardDelete', () => {
  it('returns rows with a computed `days_since_deleted` field', async () => {
    const mock = createMockDb({
      findExpiredSoftDeleted: async () => [
        {
          id: 'a',
          name: 'Org A',
          subdomain: 'a',
          deleted_at: daysAgo(45),
          deleted_by: 'user-1',
          project_count: 2,
          bug_report_count: 17,
        },
        {
          id: 'b',
          name: 'Org B',
          subdomain: 'b',
          deleted_at: daysAgo(31),
          deleted_by: null,
          project_count: 0,
          bug_report_count: 0,
        },
      ],
    });
    const service = new OrganizationService(mock.db);

    const result = await service.listPendingHardDelete(RETENTION_DAYS);

    expect(result).toHaveLength(2);
    // Date arithmetic can be off-by-one because of floor/epoch-day alignment;
    // accept a tight window.
    expect(result[0]).toMatchObject({ subdomain: 'a', project_count: 2, bug_report_count: 17 });
    expect(result[0].days_since_deleted).toBeGreaterThanOrEqual(44);
    expect(result[0].days_since_deleted).toBeLessThanOrEqual(45);
    expect(result[1].days_since_deleted).toBeGreaterThanOrEqual(30);
    expect(result[1].days_since_deleted).toBeLessThanOrEqual(31);
  });

  it('passes the configured retention window through to the repo', async () => {
    const mock = createMockDb();
    const service = new OrganizationService(mock.db);

    await service.listPendingHardDelete(7);

    expect(mock.db.organizations.findExpiredSoftDeleted).toHaveBeenCalledWith(7);
  });
});

// ---------------------------------------------------------------------------
// hardDeleteExpired
// ---------------------------------------------------------------------------

describe('OrganizationService.hardDeleteExpired', () => {
  const validOrg = {
    id: 'org-1',
    subdomain: 'acme',
    name: 'Acme',
    deleted_at: daysAgo(45),
  };

  it('writes an audit log and hard-deletes on the happy path', async () => {
    const mock = createMockDb({
      findByIdIncludeDeleted: async () => validOrg,
      countByOrganizationId: async () => 3,
      countBugReportsByOrganizationId: async () => 42,
    });
    const service = new OrganizationService(mock.db);

    const result = await service.hardDeleteExpired(
      validOrg.id,
      RETENTION_DAYS,
      'admin-user',
      validOrg.subdomain
    );

    expect(result).toEqual({ id: 'org-1', subdomain: 'acme', name: 'Acme' });
    expect(mock.log.auditCreated).toHaveLength(1);
    const audit = mock.log.auditCreated[0] as {
      action: string;
      resource: string;
      resource_id: string;
      user_id: string;
      organization_id: string | null;
      details: Record<string, unknown>;
    };
    expect(audit.action).toBe('organization.hard_delete');
    expect(audit.resource).toBe('organization');
    expect(audit.resource_id).toBe('org-1');
    expect(audit.user_id).toBe('admin-user');
    // `organization_id` is intentionally null so the audit survives the FK
    // CASCADE-SET-NULL that fires when the org row disappears. Identity
    // lives in `details` instead.
    expect(audit.organization_id).toBeNull();
    expect(audit.details).toMatchObject({
      subdomain: 'acme',
      name: 'Acme',
      retention_days: RETENTION_DAYS,
      project_count_at_delete: 3,
      bug_report_count_at_delete: 42,
    });

    expect(mock.log.hardDeleted).toEqual(['org-1']);
  });

  it('throws 400 when the typed subdomain does not match', async () => {
    // Server-side mirror of the UI's typed-confirmation. If the dialog were
    // ever bypassed (direct API call, stale frontend, scripted tool), the
    // service still refuses to cascade-delete without an exact match.
    const mock = createMockDb({ findByIdIncludeDeleted: async () => validOrg });
    const service = new OrganizationService(mock.db);

    const err = await service
      .hardDeleteExpired('org-1', RETENTION_DAYS, 'admin', 'wrong-subdomain')
      .catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/subdomain confirmation/i);
    // No audit, no delete — the mismatch is rejected before the tx opens.
    expect(mock.log.auditCreated).toHaveLength(0);
    expect(mock.log.hardDeleted).toHaveLength(0);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it('throws 404 when the organization does not exist', async () => {
    const mock = createMockDb({ findByIdIncludeDeleted: async () => null });
    const service = new OrganizationService(mock.db);

    await expect(
      service.hardDeleteExpired('nope', RETENTION_DAYS, 'admin', 'anything')
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 409 when the organization is NOT soft-deleted', async () => {
    const mock = createMockDb({
      findByIdIncludeDeleted: async () => ({ ...validOrg, deleted_at: null }),
    });
    const service = new OrganizationService(mock.db);

    await expect(
      service.hardDeleteExpired('org-1', RETENTION_DAYS, 'admin', validOrg.subdomain)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/not soft-deleted/i) as unknown as string,
    });
  });

  it('throws 409 when the org is inside the retention window', async () => {
    // Soft-deleted only 10 days ago, window is 30.
    const mock = createMockDb({
      findByIdIncludeDeleted: async () => ({ ...validOrg, deleted_at: daysAgo(10) }),
    });
    const service = new OrganizationService(mock.db);

    const err = await service
      .hardDeleteExpired('org-1', RETENTION_DAYS, 'admin', validOrg.subdomain)
      .catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/retention window/i);
    expect(err.message).toMatch(/eligible in \d+ day/i);
  });

  it('throws 409 and rolls back audit if the guarded DELETE does not match (concurrent restore)', async () => {
    // Simulate a race: by the time we execute the DELETE, `deleted_at` has
    // been flipped back to NULL. Our guard (WHERE deleted_at < ...) doesn't
    // match, rowCount is 0, the service throws, and the tx rollback should
    // discard the audit log we wrote.
    const mock = createMockDb({
      findByIdIncludeDeleted: async () => validOrg,
      hardDeleteExpiredSoftDeleted: async () => false, // guard did not hold
    });
    const service = new OrganizationService(mock.db);

    const err = await service
      .hardDeleteExpired('org-1', RETENTION_DAYS, 'admin', validOrg.subdomain)
      .catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/state changed during delete/i);
    // The hard-delete attempt was made (and correctly returned false)…
    expect(mock.db.transaction).toHaveBeenCalledOnce();
    // …but the audit log write is rolled back by the tx throw. The mock
    // records the create() call, but in real execution the row would be
    // discarded — what we care about is that the tx-level throw happened.
    // (For this mock the `auditLogs.create` call is still observed; the
    // real rollback is a DB-level guarantee.)
    expect(mock.log.auditCreated).toHaveLength(1);
  });
});
