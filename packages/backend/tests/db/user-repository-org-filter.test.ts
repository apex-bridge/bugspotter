/**
 * Unit tests for the SaaS-mode gate on `UserRepository.listWithFilters`.
 *
 * The `organization_id` filter references `saas.organization_members`,
 * which only exists in SaaS deployments. In self-hosted mode the schema
 * may not be present at all — applying the predicate would error with
 * "schema saas does not exist" even though the route is gated to
 * platform admins. These tests pin that the predicate is silently
 * skipped in self-hosted mode and present in SaaS mode.
 *
 * The pool's `query` is intercepted to return canned counts and inspect
 * the SQL that the repository emits — no DB connection required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { UserRepository } from '../../src/db/repositories/user.repository.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';

function makeFakePool(captured: string[]): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      captured.push(sql);
      // Count query comes first; data query comes second. Either way return
      // an empty rowset — we only care about the SQL shape, not the data.
      if (sql.toUpperCase().includes('COUNT')) {
        return { rows: [{ total: '0' }] };
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
}

describe('UserRepository.listWithFilters — organization_id SaaS gate', () => {
  const originalMode = process.env.DEPLOYMENT_MODE;

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalMode;
    }
    resetDeploymentConfig();
  });

  beforeEach(() => {
    // Force a re-read of DEPLOYMENT_MODE on each test.
    resetDeploymentConfig();
  });

  it('emits the saas.organization_members predicate in SaaS mode', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const captured: string[] = [];
    const repo = new UserRepository(makeFakePool(captured));

    await repo.listWithFilters({ organization_id: '00000000-0000-0000-0000-000000000001' });

    const sql = captured.join('\n');
    expect(sql).toMatch(/saas\.organization_members/);
    expect(sql).toMatch(/EXISTS/);
  });

  it('omits the saas.organization_members predicate in self-hosted mode', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const captured: string[] = [];
    const repo = new UserRepository(makeFakePool(captured));

    await repo.listWithFilters({ organization_id: '00000000-0000-0000-0000-000000000001' });

    const sql = captured.join('\n');
    // Self-hosted mode may not even have the `saas` schema; the predicate
    // would error if applied.
    expect(sql).not.toMatch(/saas\.organization_members/);
  });

  it('does not emit the predicate when organization_id is not set, regardless of mode', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const captured: string[] = [];
    const repo = new UserRepository(makeFakePool(captured));

    await repo.listWithFilters({ role: 'admin' });

    const sql = captured.join('\n');
    expect(sql).not.toMatch(/saas\.organization_members/);
  });
});
