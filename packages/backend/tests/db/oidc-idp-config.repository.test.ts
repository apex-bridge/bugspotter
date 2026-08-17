import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { OidcIdpConfigRepository } from '../../src/db/repositories/oidc-idp-config.repository.js';
import { getEncryptionService } from '../../src/utils/encryption.js';

vi.mock('../../src/utils/encryption.js', () => ({
  getEncryptionService: vi.fn(),
}));

const fakeEnc = {
  encrypt: vi.fn((s: string) => `enc::${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc::', '')),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEncryptionService).mockReturnValue(fakeEnc as never);
});

/** Fake pg.Pool whose query() returns canned rows and records what was sent. */
function makeFakePool(rows: unknown[], captured: { sql: string; params: unknown[] }[]): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      // Copy the array at capture time. `params` is the same array
      // reference the repository built and passed to query() — if a
      // buggy implementation mutated it after this call (e.g. swapped a
      // plaintext secret for ciphertext post-hoc), pushing the reference
      // would let `captured` observe that later mutation instead of what
      // was actually sent when query() was invoked, defeating test case E
      // (AC #5)'s one job: proving the plaintext never reached the SQL
      // layer at call time.
      captured.push({ sql, params: [...params] });
      return { rows };
    }),
  } as unknown as Pool;
}

describe('OidcIdpConfigRepository', () => {
  it('migration file uses CREATE TABLE IF NOT EXISTS in the saas schema', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const migrationsDir = join(__dirname, '../../src/db/migrations');
    const files = readdirSync(migrationsDir).filter((f) => f.includes('oidc_idp_config'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.sql$/);
    const content = readFileSync(join(migrationsDir, files[0]), 'utf8');
    expect(content).toMatch(/CREATE TABLE IF NOT EXISTS oidc_idp_config/i);
    expect(content).toMatch(/SET search_path TO saas/);
  });

  it('second upsert with the same tenantId issues ON CONFLICT (tenant_id) DO UPDATE', async () => {
    const row = {
      id: 'uuid-1',
      tenant_id: 'tenant-a',
      issuer_url: 'https://idp.example.com',
      client_id: 'client-2',
      encrypted_client_secret: 'enc::secret2',
      allowed_domains: [] as string[],
      enforce_sso: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const captured: { sql: string; params: unknown[] }[] = [];
    const repo = new OidcIdpConfigRepository(makeFakePool([row], captured));

    await repo.upsert({
      tenantId: 'tenant-a',
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-1',
      clientSecret: 'secret1',
      allowedDomains: [],
      enforceSso: false,
    });
    const result = await repo.upsert({
      tenantId: 'tenant-a',
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-2',
      clientSecret: 'secret2',
      allowedDomains: [],
      enforceSso: false,
    });

    expect(result.clientId).toBe('client-2');
    expect(captured).toHaveLength(2);
    for (const call of captured) {
      expect(call.sql).toMatch(/ON CONFLICT \(tenant_id\) DO UPDATE/);
    }
  });

  it('findByTenantId returns null when no row exists for the tenantId', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const repo = new OidcIdpConfigRepository(makeFakePool([], captured));

    const result = await repo.findByTenantId('no-such-tenant');

    expect(result).toBeNull();
  });

  it('findByTenantId returns the decrypted clientSecret', async () => {
    const storedRow = {
      id: 'uuid-1',
      tenant_id: 'tenant-a',
      issuer_url: 'https://idp.example.com',
      client_id: 'client-1',
      encrypted_client_secret: 'enc::my-secret',
      allowed_domains: ['example.com'],
      enforce_sso: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const captured: { sql: string; params: unknown[] }[] = [];
    const repo = new OidcIdpConfigRepository(makeFakePool([storedRow], captured));

    const result = await repo.findByTenantId('tenant-a');

    expect(result).not.toBeNull();
    expect(result!.clientSecret).toBe('my-secret');
    expect(fakeEnc.decrypt).toHaveBeenCalledWith('enc::my-secret');
  });

  it('upsert passes the encrypted secret to the database, not the plaintext', async () => {
    const returnedRow = {
      id: 'uuid-1',
      tenant_id: 'tenant-a',
      issuer_url: 'https://idp.example.com',
      client_id: 'client-1',
      encrypted_client_secret: 'enc::plaintext',
      allowed_domains: [] as string[],
      enforce_sso: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const captured: { sql: string; params: unknown[] }[] = [];
    const repo = new OidcIdpConfigRepository(makeFakePool([returnedRow], captured));

    await repo.upsert({
      tenantId: 'tenant-a',
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-1',
      clientSecret: 'plaintext',
      allowedDomains: [],
      enforceSso: false,
    });

    expect(fakeEnc.encrypt).toHaveBeenCalledWith('plaintext');
    const [call] = captured;
    // encrypted_client_secret is the 4th positional parameter in the INSERT.
    expect(call.params[3]).toBe('enc::plaintext');
    expect(call.params[3]).not.toBe('plaintext');
  });

  it('OidcIdpConfigRepository and its types are exported from the repositories barrel', async () => {
    const barrel = await import('../../src/db/repositories.js');
    expect(barrel.OidcIdpConfigRepository).toBeDefined();
    // Type exports cannot be checked at runtime; the typecheck command covers them.
  });
});
