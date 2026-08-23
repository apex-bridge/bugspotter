import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OidcIdpConfigRepository } from '../../../src/db/repositories/oidc-idp-config.repository.js';

describe('assertSsoNotEnforced', () => {
  const originalEnv = process.env;
  const mockRepo = { findByTenantId: vi.fn() } as unknown as OidcIdpConfigRepository;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws SsoEnforcedError in selfhosted mode when config.oidc.enforceSso is true', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    process.env.OIDC_ENFORCE_SSO = 'true';
    vi.resetModules();
    const { assertSsoNotEnforced, SsoEnforcedError } = await import(
      '../../../src/api/middleware/enforce-sso.js'
    );

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).rejects.toBeInstanceOf(
      SsoEnforcedError
    );
    expect(mockRepo.findByTenantId).not.toHaveBeenCalled();
  });

  it('resolves in selfhosted mode when config.oidc.enforceSso is false', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    process.env.OIDC_ENFORCE_SSO = 'false';
    vi.resetModules();
    const { assertSsoNotEnforced } = await import('../../../src/api/middleware/enforce-sso.js');

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).resolves.toBeUndefined();
  });

  it('throws SsoEnforcedError in saas mode when the repository resolves enforceSso: true', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    vi.resetModules();
    const { assertSsoNotEnforced, SsoEnforcedError } = await import(
      '../../../src/api/middleware/enforce-sso.js'
    );
    mockRepo.findByTenantId = vi.fn().mockResolvedValue({ enforceSso: true });

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).rejects.toBeInstanceOf(
      SsoEnforcedError
    );
  });

  it('resolves in saas mode when the repository resolves null', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    vi.resetModules();
    const { assertSsoNotEnforced } = await import('../../../src/api/middleware/enforce-sso.js');
    mockRepo.findByTenantId = vi.fn().mockResolvedValue(null);

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).resolves.toBeUndefined();
  });

  it('resolves in saas mode when the repository resolves enforceSso: false', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    vi.resetModules();
    const { assertSsoNotEnforced } = await import('../../../src/api/middleware/enforce-sso.js');
    mockRepo.findByTenantId = vi.fn().mockResolvedValue({ enforceSso: false });

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).resolves.toBeUndefined();
  });

  it('propagates the original error when the repository lookup rejects in saas mode', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    vi.resetModules();
    const { assertSsoNotEnforced } = await import('../../../src/api/middleware/enforce-sso.js');
    const dbError = new Error('connection refused');
    mockRepo.findByTenantId = vi.fn().mockRejectedValue(dbError);

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).rejects.toBe(dbError);
  });

  it('takes the selfhosted path (does not call findByTenantId) when DEPLOYMENT_MODE is unset', async () => {
    delete process.env.DEPLOYMENT_MODE;
    process.env.OIDC_ENFORCE_SSO = 'false';
    vi.resetModules();
    const { assertSsoNotEnforced } = await import('../../../src/api/middleware/enforce-sso.js');

    await expect(assertSsoNotEnforced('tenant-1', mockRepo)).resolves.toBeUndefined();
    expect(mockRepo.findByTenantId).not.toHaveBeenCalled();
  });
});
