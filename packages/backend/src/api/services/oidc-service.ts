import { Issuer, generators } from 'openid-client';
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';
import { getCacheService } from '../../cache/index.js';

const STATE_TTL_SECONDS = 600;

export interface OidcStatePayload {
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  tenantId: string;
  issuer: string;
}

export async function discoverIssuerValidated(issuerUrl: string) {
  validateSSRFProtection(issuerUrl);
  const issuer = await Issuer.discover(issuerUrl);
  if (!issuer.metadata.token_endpoint || !issuer.metadata.jwks_uri) {
    throw new Error('IdP discovery response missing required endpoints');
  }
  validateSSRFProtection(issuer.metadata.token_endpoint);
  validateSSRFProtection(issuer.metadata.jwks_uri);
  return issuer;
}

export async function storeOidcState(stateKey: string, payload: OidcStatePayload): Promise<void> {
  await getCacheService().set(`oidc:state:${stateKey}`, payload, STATE_TTL_SECONDS);
}

export { generators };
