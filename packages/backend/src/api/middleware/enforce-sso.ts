import { config } from '../../config.js';
import type { OidcIdpConfigRepository } from '../../db/repositories/oidc-idp-config.repository.js';

export class SsoEnforcedError extends Error {
  constructor() {
    super('sso_enforced');
  }
}

export async function assertSsoNotEnforced(
  tenantId: string,
  oidcIdpConfigs: OidcIdpConfigRepository
): Promise<void> {
  if (process.env.DEPLOYMENT_MODE === 'saas') {
    // DB errors here (connection failure, etc.) are intentionally not caught:
    // they propagate and fail the auth request, rather than being treated as
    // an absent config and silently resolving to "not enforced".
    const idpConfig = await oidcIdpConfigs.findByTenantId(tenantId);
    if (idpConfig?.enforceSso) {
      throw new SsoEnforcedError();
    }
    return;
  }

  // selfhosted mode — also the default when DEPLOYMENT_MODE is unset or
  // unrecognized, matching getDeploymentConfig()'s own fallback.
  if (config.oidc.enforceSso) {
    throw new SsoEnforcedError();
  }
}
