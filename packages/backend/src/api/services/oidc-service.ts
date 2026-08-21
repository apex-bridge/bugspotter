import { Issuer, generators, custom } from 'openid-client';
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';
import { pinHostnameToIp } from '../../integrations/security/hardened-http.js';
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
  const parsedUrl = validateSSRFProtection(issuerUrl);

  // `validateSSRFProtection` above only checks the URL string.
  // `Issuer.discover()` (openid-client@5.7.1) issues its own outbound
  // request via raw `http(s).request`, which re-resolves DNS at connect
  // time — a DNS-rebinding attacker could return a public IP for the
  // check above and a private one for the actual connection. Pin the
  // resolved IP via the same `pinHostnameToIp` helper `hardened-http.ts`
  // uses for the Jira/generic-http clients, threaded through
  // openid-client's documented per-request `custom.http_options` hook.
  //
  // Setting `Issuer[custom.http_options]` immediately before — with no
  // `await` in between — calling `Issuer.discover()` is safe under
  // concurrent requests for other tenants/issuers: the library reads it
  // synchronously before its first internal `await`, so the value is
  // consumed (baked into the underlying `https.request` options) before
  // control can yield back to the event loop.
  const { lookup } = await pinHostnameToIp(parsedUrl.hostname);
  Issuer[custom.http_options] = () => ({ lookup });
  let issuer;
  try {
    issuer = await Issuer.discover(issuerUrl);
  } finally {
    Issuer[custom.http_options] = () => ({});
  }

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
