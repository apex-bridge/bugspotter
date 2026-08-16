# Spec: SSO / OIDC Login

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #265
ADR: pending

**Files touched:**

- `packages/backend/package.json` (add `openid-client` dependency)
- `packages/backend/src/db/migrations/NNN_add_oidc_idp_config.sql` (new; the repo's migration convention is a 3-digit sequence number — see `packages/backend/CLAUDE.md` — replace NNN with the next unused 3-digit number in the migrations directory, e.g. `027` as of this writing, not a 4-digit `NNNN`)
- `packages/backend/src/db/repositories/oidc-idp-config.repository.ts` (new; encrypts `client_secret` at rest via `getEncryptionService()` — see Constraint 11)
- `packages/backend/src/db/repositories.ts` (export new repository)
- `packages/backend/src/api/routes/oidc.ts` (new; validates `issuerUrl` via the existing `validateSSRFProtection()`, gates `/admin/oidc-config` via the existing `requireTenantOrgRole()`, and never returns `clientSecret` from `GET` — see Constraints 12, 13, 14)
- `packages/backend/src/api/routes/auth.ts` (add enforce-SSO guard to the password-login handler AND the registration handler — see Constraint 8)
- `packages/backend/src/api/routes/admin-organizations.ts` (add enforce-SSO guard to the magic-token issuance endpoint — see Constraint 8)
- `packages/backend/src/api/schemas/oidc.schema.ts` (new)
- `packages/backend/src/api/server.ts` (register the new route module — see note under Changes; NOT `api/index.ts`, which is the package's export barrel, not where routes are wired up)
- `packages/backend/src/config.ts` (add selfhosted OIDC env vars)
- `apps/admin/src/hooks/use-sso-config.ts` (new)
- `apps/admin/src/pages/sso-config.tsx` (new; verify naming convention against sibling files in `apps/admin/src/pages/` before creating)
- `apps/admin/src/components/auth/` (add SSO button to login form — exact filename must be confirmed in the directory; not enumerated in source tree)
- `apps/admin/src/App.tsx` (add `/sso-config` protected route)
- `apps/admin/src/i18n/` (add SSO translation keys — exact filenames to confirm per conventions in `apps/admin/CLAUDE.md`)
- `packages/backend/tests/api/oidc.test.ts` (new)

**Blocking prerequisites:** none

## Problem

BugSpotter authenticates users exclusively via email+password (bcrypt) and JWT, with API keys for programmatic access. There is no OIDC, SAML, or SCIM login path — the existing `oauth-token.repository.ts` is OAuth for integration ticket-filing, not user identity. Enterprise and corporate procurement teams at organizations using Keycloak, Azure AD, Google Workspace, or Okta cannot onboard without SSO, making this the top-ranked deal-blocker in the deployment audit (internal-gaps.md #1). The feature is tracked-not-urgent until a deal with an SSO clause is active, but the spec is needed to bound scope and unblock estimation.

## Out of scope

- SAML authentication — larger scope, separate follow-up issue
- SCIM user provisioning — separate follow-up issue
- Multi-IdP-per-tenant (v1 enforces one IdP per org via `UNIQUE (tenant_id)`)
- Group/role mapping from OIDC claims to BugSpotter RBAC roles
- The `oauth-token.repository.ts` OAuth flow — that is integration OAuth, not user login
- The ADR itself — must be drafted and accepted before implementation begins (see Constraint 1)

## Constraints

1. An ADR covering provider abstraction, the account-linking rule, tenant→IdP mapping in `saas` mode, and whether SSO users may also hold API keys must be written and accepted before implementation begins. This spec records the decisions below as the proposed defaults; the ADR may revise them.
2. The OIDC callback must reuse the same refresh-token cookie issuance path used by the existing password-login handler in `packages/backend/src/api/routes/auth.ts`; no second session type is permitted.
3. PKCE S256 is required; the implicit flow and plain PKCE are not accepted.
4. CSRF state and nonce must survive the browser redirect round-trip in Redis via the existing cache layer (`packages/backend/src/cache/cache-service.ts`); TTL ≤ 10 minutes. The write/read method signatures on `CacheService` were ASSUMED and have now been VERIFIED against the source tree: `CacheService.set<T>(key: string, value: T, ttl: number): Promise<void>`, `.get<T>(key: string): Promise<T | null>`, `.delete(key: string): Promise<void>` — the skeleton in the Changes section below matches the real signatures. `state` must be generated via `openid-client`'s `generators.state()` (cryptographically random, unguessable) and used as the Redis key so only a party who received the redirect can present it; it must be deleted on first read (one-time use). `nonce` must be passed into `client.callback(..., { nonce: stateData.nonce })` so `openid-client` itself checks it against the returned ID token's `nonce` claim — never merely store the nonce without also passing it into the check. Note for the ADR: this design does not bind `state` to the initiating browser (e.g. via a short-lived host-only cookie compared at callback time), so a classic OAuth "login CSRF" (attacker starts their own IdP flow, then relays the resulting `code`/`state` to a victim so the victim's browser gets logged into the attacker's account) is not fully closed by state-existence-in-Redis alone. Low severity here (no existing-account takeover; worst case is a confused-identity session), but the ADR should decide whether to add cookie-bound state as defense-in-depth.
5. ID-token validation must verify `iss`, `aud`, `nonce`, `exp`, and the JWKS-backed signature using `openid-client` v5 (FAPI-certified, actively maintained). Custom JOSE parsing is not permitted.
6. Account-linking rule: the ID-token `email` claim is trusted only when `email_verified: true`; it is matched case-insensitively against `users.email`. Match → link the existing row (no new user created). No match → create a new user row (create-on-first-login). This rule must appear verbatim in the ADR.
7. In `saas` mode, IdP config is stored per-tenant in `oidc_idp_config` (one row per org, enforced by `UNIQUE (tenant_id)`). In `selfhosted` mode, env vars `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` configure a single global IdP; no DB row is required for v1.
8. When a tenant has `enforce_sso = true`, the existing `POST /auth/login` endpoint must return HTTP 403 `{"error":"sso_enforced"}` for that tenant's users. The admin UI login form must hide the password fields and show only the SSO button when the tenant's IdP config has `enforce_sso` set.

   **This guard must cover every path that can mint a session without going through the IdP, not just `POST /auth/login`.** A review of `packages/backend/src/api/routes/auth.ts` found two paths that independently issue a full access+refresh session and are NOT reached by an `/auth/login`-only guard:
   - `POST /auth/register` calls `generateAuthTokens()` and sets the session cookie directly inside the registration handler — it never calls `/auth/login`. If a tenant has self-registration enabled (`config.auth.allowRegistration`), a new password-based account can be created and immediately logged in, fully bypassing `enforce_sso`, even when `requireInvitationToRegister` is on (an org admin routinely inviting a new teammate is enough to trigger this — invitation-gating restricts _who_ can register, not _how_ they authenticate afterward).
   - `POST /auth/magic-login` redeems a JWT "magic token" for a full session, gated only by the target org's independent `magic_login_enabled` setting — not by `enforce_sso`. The token itself is minted by `POST /api/v1/admin/organizations/:id/magic-token` (`admin-organizations.ts`), a platform-admin-only endpoint that already functions as an impersonation path (mints a 30-day-default session for any user in any org on admin request). `enforce_sso` and `magic_login_enabled` are independent booleans on the same org settings object, so nothing stops both being true simultaneously — at which point a platform-admin credential (or a token it already issued) silently defeats the tenant's SSO requirement.

   Both must be closed: `POST /auth/register` must return the same 403 `{"error":"sso_enforced"}` when the resolved tenant has `enforce_sso = true` (reject password-based account creation, do not just skip token issuance — an orphaned unusable account is still an information leak); `POST /auth/magic-login` and `POST /api/v1/admin/organizations/:id/magic-token` must both reject (403 `sso_enforced`) when the target org has `enforce_sso = true`, regardless of `magic_login_enabled`. The ADR must record this as the intended interaction between `enforce_sso` and the existing `allowRegistration`/`requireInvitationToRegister`/`magic_login_enabled` settings — it is not optional hardening, it is the actual scope of "enforce".

9. `COOKIE_DOMAIN` must be forwarded to the same `setCookie` call used by the existing login handler so cross-subdomain sessions continue to work in `saas` mode (see `apps/admin/CLAUDE.md`).
10. The migration must use `CREATE TABLE IF NOT EXISTS` (idempotent), consistent with the repo migration convention.
11. `oidc_idp_config`'s OIDC client secret must be encrypted at rest, matching the repo's established secrets-at-rest pattern. `packages/backend/src/integrations/jira/config.ts` never stores a Jira API token in a plaintext column — it stores an `encrypted_credentials` blob produced by `getEncryptionService().encrypt(...)` (`packages/backend/src/utils/encryption.ts`, `CredentialEncryption`, AES-256-GCM) and decrypts it with `.decrypt()` on read; the same `getEncryptionService()` singleton is reused across `integrations.ts`, `intelligence-settings.ts`, `jobs.ts`, `linear/config.ts`, and `key-provisioning.ts`. The `oidc_idp_config` migration and repository must follow this pattern for `client_secret`: the column is `encrypted_client_secret TEXT NOT NULL` (never a plaintext `client_secret` column), the repository encrypts before `INSERT`/`UPDATE` and decrypts after `SELECT`, and the decrypted value is held only in memory for the duration of the OIDC discovery/token-exchange call. This is a correction to an earlier draft of this spec, which had `client_secret TEXT NOT NULL` storing the secret in plaintext — that draft did not follow repo convention and must not be implemented as originally written.
12. `issuerUrl` is tenant-admin-controlled input handed to `Issuer.discover(issuerUrl)`, which makes an outbound HTTP request to whatever host is stored — including internal-only hosts and cloud metadata endpoints (`http://169.254.169.254/...`) — an SSRF vector (found by automated review of this spec). The repo already has a reusable guard for exactly this: `validateSSRFProtection(url: string): URL` in `packages/backend/src/integrations/security/ssrf-validator.ts` (used by `integrations/security/rpc-bridge.ts` for the same class of problem — outbound requests to attacker/tenant-supplied URLs). `issuerUrl` must be passed through `validateSSRFProtection()` in two places: (a) inside `PUT /admin/oidc-config`, before persisting, so a bad URL fails fast with a clear error; and (b) again immediately before every `Issuer.discover(issuerUrl)` call at login/callback time, as defense-in-depth against DNS-rebinding/TOCTOU between save and use. Do not implement custom hostname/IP filtering — reuse the existing validator.
13. `GET /admin/oidc-config` and `PUT /admin/oidc-config` must require tenant-admin privileges, not merely a valid session (found by automated review of this spec — the original skeleton used only `onRequest: [app.authenticate]`, which any authenticated user in the tenant, including a regular non-admin member, would pass). Use `requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)` from `packages/backend/src/api/middleware/org-access.ts` (the existing helper for tenant-scoped admin routes with no `:id` route param — see its use in `packages/backend/src/api/routes/billing.ts`), chained after `requireUser`: `preHandler: [requireUser, requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)]`. Without this, any tenant member — not just an admin — could point `issuerUrl`/`clientId`/`clientSecret` at an attacker-controlled IdP and set `enforceSso: true`, hijacking every subsequent login for that tenant (this compounds with the SSRF gap in Constraint 12 and the plaintext-secret gap in Constraint 11 — all three were present in the same three-line route skeleton).
14. `GET /admin/oidc-config` must never return the decrypted `client_secret` to the client (found by automated review of this spec — `OidcIdpConfigRepository.mapRow` decrypts `encrypted_client_secret` on every read per Constraint 11, and the original GET handler skeleton returned that object directly, shipping the plaintext secret to the browser on every page load). The GET response must omit `clientSecret` entirely (or replace it with a boolean `hasClientSecret: true`/masked placeholder). The admin UI must treat an empty/unchanged secret field on save as "keep the existing secret" (only overwrite when the admin actually types a new value) rather than requiring the admin to re-enter it every time. This changes test case H (see Tests section) — the PUT/GET round-trip no longer expects `clientSecret` back from GET.
15. The migration's `allowed_domains TEXT[]` column must actually be enforced, not merely stored. When `allowed_domains` is non-empty for a tenant's IdP config, the OIDC callback handler must reject (403) any login whose ID-token `email` claim's domain is not in that list, before the account-linking step (Constraint 6) runs. Without this check the column is decorative: an admin who configures `allowedDomains: ['corp.example.com']` expecting to restrict SSO to that domain gets no such restriction, and the blast radius of a misconfigured or overly-broad IdP tenant (e.g. a shared/multi-tenant Okta or Azure AD org, or a consumer IdP accidentally wired up instead of the corporate one) is every email the IdP will assert `email_verified: true` for — not just the intended domain.

## Acceptance criteria

- [ ] A user whose email is registered in a configured IdP can complete `GET /auth/oidc/:tenant/login` → IdP → `GET /auth/oidc/:tenant/callback` and receives a session cookie accepted by the existing JWT auth middleware — verified by test case A.
- [ ] `POST /auth/login` with valid password credentials succeeds for a tenant with no OIDC config — verified by test case B.
- [ ] `POST /auth/login` returns HTTP 403 `{"error":"sso_enforced"}` when the resolved tenant has `enforce_sso = true` — verified by test case C.
- [ ] A callback carrying an ID token with an expired `exp` claim is rejected with HTTP 401 — verified by test case D.
- [ ] A callback carrying an ID token whose `iss` or `aud` mismatches the configured IdP is rejected with HTTP 401 — verified by test case D.
- [ ] A callback carrying an ID token with a tampered (invalid) signature is rejected with HTTP 401 — verified by test case D.
- [ ] A callback whose `state` query parameter has no matching Redis key returns HTTP 400 — verified by test case G.
- [ ] An OIDC login whose ID-token `email` matches an existing `users` row produces no new user row — verified by test case E.
- [ ] An OIDC login whose ID-token `email` has no matching `users` row produces exactly one new user row — verified by test case F.
- [ ] `PUT /admin/oidc-config` with a valid body persists the config; a subsequent `GET /admin/oidc-config` returns the same `issuerUrl`/`clientId`/`allowedDomains`/`enforceSso` values but never the `clientSecret` field (Constraint 14) — verified by test case H.
- [ ] The `client_secret` submitted via `PUT /admin/oidc-config` is never persisted in plaintext — the raw value written to the `oidc_idp_config` row does not equal the submitted secret, and `OidcIdpConfigRepository.findByTenantId` returns the correctly round-tripped (decrypted) value — verified by test case I.
- [ ] `POST /auth/register` returns HTTP 403 `{"error":"sso_enforced"}` when the resolved tenant has `enforce_sso = true`, even with a valid invitation token — verified by test case J.
- [ ] `POST /auth/magic-login` and `POST /admin/organizations/:id/magic-token` both return HTTP 403 `{"error":"sso_enforced"}` for an org with `enforce_sso = true`, regardless of `magic_login_enabled` — verified by test case K.
- [ ] A callback carrying a verified-email ID token whose email domain is not in a non-empty `allowedDomains` list is rejected with HTTP 403 before any user is created or linked — verified by test case L.
- [ ] `PUT /admin/oidc-config` with an `issuerUrl` pointing at a private/internal address (e.g. `http://169.254.169.254/`, `http://localhost:6379`) is rejected with HTTP 400 before any discovery request is attempted — verified by test case M.
- [ ] `GET /admin/oidc-config` and `PUT /admin/oidc-config` both return HTTP 403 for an authenticated tenant member who is not a tenant admin (`ORG_MEMBER_ROLE.ADMIN` or higher) — verified by test case N.

## Changes

### `packages/backend/src/db/migrations/NNN_add_oidc_idp_config.sql`

New migration. Replace `NNN` with the next unused 3-digit sequence number in the migrations directory (e.g. `027` as of this writing — see `packages/backend/CLAUDE.md`'s `NNN_description.sql` convention; do not use a 4-digit number).

```sql
-- New file:
CREATE TABLE IF NOT EXISTS oidc_idp_config (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  issuer_url               TEXT        NOT NULL,
  client_id                TEXT        NOT NULL,
  -- Encrypted via CredentialEncryption (packages/backend/src/utils/encryption.ts),
  -- the same AES-256-GCM service used for project_integrations.encrypted_credentials.
  -- NEVER store the client secret in plaintext — see Constraint 11.
  encrypted_client_secret  TEXT        NOT NULL,
  allowed_domains          TEXT[]      NOT NULL DEFAULT '{}',
  enforce_sso              BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

COMMENT ON COLUMN oidc_idp_config.encrypted_client_secret IS 'OIDC client secret, encrypted at rest via CredentialEncryption — never plaintext';
```

### `packages/backend/src/db/repositories/oidc-idp-config.repository.ts`

New repository. Follows the pattern of sibling files in `packages/backend/src/db/repositories/`. The `DatabaseClient` type and `.query()` signature were ASSUMED and have now been VERIFIED against `packages/backend/src/db/client.ts`: `async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>` — the skeleton below matches.

`clientSecret` on the domain type is the decrypted, in-memory value (needed by `oidc.ts` to call `Issuer.discover`/`client.callback`). It is encrypted with `getEncryptionService().encrypt()` immediately before every `INSERT`/`UPDATE` and decrypted with `.decrypt()` immediately after every `SELECT` — mirroring `JiraConfigManager.saveToDatabase`/`fromDatabase` in `packages/backend/src/integrations/jira/config.ts`. See Constraint 11.

```ts
// New file:
import type { DatabaseClient } from '../client.js';
import { getEncryptionService } from '../../utils/encryption.js';

export interface OidcIdpConfig {
  id: string;
  tenantId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string; // decrypted; never write this field straight to a column
  allowedDomains: string[];
  enforceSso: boolean;
}

export class OidcIdpConfigRepository {
  private readonly encryption = getEncryptionService();

  constructor(private readonly db: DatabaseClient) {}

  async findByTenantId(tenantId: string): Promise<OidcIdpConfig | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id, tenant_id, issuer_url, client_id, encrypted_client_secret, allowed_domains, enforce_sso
         FROM oidc_idp_config WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async upsert(
    tenantId: string,
    patch: Omit<OidcIdpConfig, 'id' | 'tenantId'>
  ): Promise<OidcIdpConfig> {
    const encryptedClientSecret = this.encryption.encrypt(patch.clientSecret);
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO oidc_idp_config
         (tenant_id, issuer_url, client_id, encrypted_client_secret, allowed_domains, enforce_sso)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         issuer_url               = EXCLUDED.issuer_url,
         client_id                = EXCLUDED.client_id,
         encrypted_client_secret  = EXCLUDED.encrypted_client_secret,
         allowed_domains          = EXCLUDED.allowed_domains,
         enforce_sso              = EXCLUDED.enforce_sso,
         updated_at               = NOW()
       RETURNING *`,
      [
        tenantId,
        patch.issuerUrl,
        patch.clientId,
        encryptedClientSecret,
        patch.allowedDomains,
        patch.enforceSso,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): OidcIdpConfig {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      issuerUrl: row.issuer_url as string,
      clientId: row.client_id as string,
      clientSecret: this.encryption.decrypt(row.encrypted_client_secret as string),
      allowedDomains: row.allowed_domains as string[],
      enforceSso: row.enforce_sso as boolean,
    };
  }
}
```

### `packages/backend/src/db/repositories.ts`

Append after the last existing export line.

```ts
// Append after the last existing export:
export { OidcIdpConfigRepository } from './repositories/oidc-idp-config.repository.js';
export type { OidcIdpConfig } from './repositories/oidc-idp-config.repository.js';
```

### `packages/backend/src/api/schemas/oidc.schema.ts`

New schema file for the tenant-admin IdP config endpoints.

```ts
// New file:
export const oidcConfigBodySchema = {
  type: 'object',
  required: ['issuerUrl', 'clientId', 'clientSecret'],
  properties: {
    issuerUrl: { type: 'string', format: 'uri' },
    clientId: { type: 'string', minLength: 1 },
    clientSecret: { type: 'string', minLength: 1 },
    allowedDomains: { type: 'array', items: { type: 'string' }, default: [] },
    enforceSso: { type: 'boolean', default: false },
  },
  additionalProperties: false,
} as const;
```

### `packages/backend/src/api/routes/oidc.ts`

New file. Implements the Authorization Code + PKCE flow and the tenant-admin IdP config endpoints. The bodies below are implementation skeletons — the exact cache-layer write/read API and the session-cookie issuance call must be confirmed by reading `packages/backend/src/cache/cache-service.ts` and the existing login handler in `packages/backend/src/api/routes/auth.ts` before writing real bodies. The `openid-client` v5 API (`Issuer.discover`, `generators.*`, `client.callback`) is assumed correct — verify on install.

```ts
// New file:
import type { FastifyInstance } from 'fastify';
import { Issuer, generators } from 'openid-client'; // v5 — verify API on install
import { OidcIdpConfigRepository } from '../../db/repositories/oidc-idp-config.repository.js';
import { oidcConfigBodySchema } from '../schemas/oidc.schema.js';
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js'; // Constraint 12
import { requireTenantOrgRole } from '../middleware/org-access.js'; // Constraint 13
import { requireUser } from '../middleware/auth.js'; // verified: re-exported here, defined in middleware/auth/authorization.ts
import { ORG_MEMBER_ROLE } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';

const STATE_TTL_SECONDS = 600;

// `db` is a constructor-style parameter, not `app.db` — this matches every
// sibling route module (authRoutes(fastify, db), billingRoutes(fastify, db),
// adminOrganizationRoutes(fastify, db) in packages/backend/src/api/server.ts).
// The original skeleton's `async ... : Promise<void>` signature is also
// changed to a plain sync function to match authRoutes/billingRoutes, which
// register routes synchronously (unlike `adminRoutes`, which is awaited).
export function oidcRoutes(app: FastifyInstance, db: DatabaseClient): void {
  // GET /auth/oidc/:tenant/login
  app.get<{ Params: { tenant: string } }>('/auth/oidc/:tenant/login', async (request, reply) => {
    const { tenant } = request.params;
    // 1. Load OidcIdpConfig for tenant from OidcIdpConfigRepository
    //    ASSUMED: repository is available via request.server or DI — verify injection pattern
    // 1a. validateSSRFProtection(config.issuerUrl) — Constraint 12, defense-in-depth
    //     re-check even though PUT already validated on save (DNS-rebinding/TOCTOU).
    //     Throws on unsafe URLs; let it propagate to a 500/400 — do not swallow it.
    // 2. Issuer.discover(config.issuerUrl) to obtain client
    // 3. Generate PKCE: codeVerifier, codeChallenge (S256), state, nonce
    //    via generators.codeVerifier(), generators.codeChallenge(), generators.state(), generators.nonce()
    // 4. cache.set(`oidc:state:${state}`, { codeVerifier, nonce, tenantId: config.tenantId }, STATE_TTL_SECONDS)
    //    ASSUMED: cache.set() accepts (key, value, ttlSeconds) — verify against cache-service.ts
    // 5. return reply.redirect(client.authorizationUrl({ ... , code_challenge, code_challenge_method: 'S256', state, nonce }))
  });

  // GET /auth/oidc/:tenant/callback
  app.get<{ Params: { tenant: string }; Querystring: { code: string; state: string } }>(
    '/auth/oidc/:tenant/callback',
    async (request, reply) => {
      const { state, code } = request.query;
      // 1. stateData = await cache.get(`oidc:state:${state}`) — reject 400 if null
      // 2. await cache.delete(`oidc:state:${state}`)  — one-time use
      // 3. Load IdP config for stateData.tenantId
      // 3a. validateSSRFProtection(config.issuerUrl) — Constraint 12, same as the /login handler.
      // 4. tokenSet = await client.callback(redirectUri, { code }, { code_verifier: stateData.codeVerifier, state, nonce: stateData.nonce })
      //    openid-client throws on exp/iss/aud/nonce/sig failures — catch and return 401
      // 5. claims = tokenSet.claims()
      //    if (!claims.email_verified) return reply.status(401).send({ error: 'email_not_verified' })
      // 5a. Domain allowlist (Constraint 15) — enforce BEFORE account linking/creation,
      //     not after. Skipping this makes the allowedDomains column purely decorative.
      //     if (config.allowedDomains.length > 0) {
      //       const emailDomain = claims.email.split('@')[1]?.toLowerCase();
      //       if (!emailDomain || !config.allowedDomains.map(d => d.toLowerCase()).includes(emailDomain)) {
      //         return reply.status(403).send({ error: 'domain_not_allowed' });
      //       }
      //     }
      // 6. user = await userRepo.findByEmail(claims.email.toLowerCase()) ?? await userRepo.create({ email: claims.email, ... })
      // 7. Issue refresh-token cookie using the same helper as password login (ASSUMED — verify in auth.ts)
      //    Honor COOKIE_DOMAIN (Constraint 9)
      // 8. reply.redirect('/dashboard')
    }
  );

  // GET /admin/oidc-config — tenant admin reads own IdP config.
  // requireTenantOrgRole (Constraint 13), not bare authentication — a
  // non-admin tenant member must not be able to read or write IdP config.
  app.get(
    '/admin/oidc-config',
    { preHandler: [requireUser, requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)] },
    async (request, reply) => {
      // Load config for request.organizationId.
      // Constraint 14: never include the decrypted clientSecret in the response.
      // const config = await oidcIdpConfigRepo.findByTenantId(request.organizationId);
      // if (!config) return reply.status(404).send();
      // const { clientSecret, ...safeConfig } = config;
      // return reply.send({ ...safeConfig, hasClientSecret: true });
    }
  );

  // PUT /admin/oidc-config — tenant admin saves IdP config.
  // Same requireTenantOrgRole guard as GET (Constraint 13).
  app.put(
    '/admin/oidc-config',
    {
      preHandler: [requireUser, requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
      schema: { body: oidcConfigBodySchema },
    },
    async (request, reply) => {
      // 1. validateSSRFProtection(request.body.issuerUrl) — Constraint 12, fail fast
      //    with a 400 before ever attempting discovery against this URL.
      // 2. If request.body.clientSecret is empty/omitted and a config row already
      //    exists, keep the existing encrypted secret rather than overwriting it
      //    with an empty value (Constraint 14 — the admin UI never has the real
      //    secret to resubmit, since GET never returns it).
      // 3. Upsert config for request.organizationId, return the saved row with
      //    the same clientSecret-omission as GET.
    }
  );
}
```

### `packages/backend/src/api/routes/auth.ts`

Add the enforce-SSO guard to **both** `POST /auth/login` and `POST /auth/register` (Constraint 8 — registration mints a session directly and is not reached by a login-only guard). `request.organizationId` is already populated by upstream subdomain-resolution middleware and is available at the top of both handlers (see the existing tenant-match gate later in `/login`, and `isPasswordResetEnabledForRequest` in the same file, both of which read `request.organizationId` the same way) — read the file to confirm the exact variable name in scope at the insertion point.

```ts
// Near the top of both POST /auth/login and POST /auth/register,
// before any password check / user creation:
const idpConfig = request.organizationId
  ? await oidcIdpConfigRepo.findByTenantId(request.organizationId)
  : null;
if (idpConfig?.enforceSso) {
  return reply.status(403).send({ error: 'sso_enforced' });
}
```

`oidcIdpConfigRepo` must be injected consistently with how other repositories are accessed in this file (`db.*`, e.g. `db.organizations`, `db.users`). Verify the injection pattern before editing — the new repository is likely reachable as `db.oidcIdpConfig` once wired through `repositories.ts` and `db/client.ts`'s `RepositoryRegistry`, but that wiring is not enumerated here; confirm against the pattern used for `db.dedupRules` or another recently-added repository.

### `packages/backend/src/api/routes/admin-organizations.ts`

Add the same guard to the two magic-login surfaces (Constraint 8): `POST /api/v1/admin/organizations/:id/magic-token` (token issuance) and, in `auth.ts`, `POST /auth/magic-login` (token redemption). Guard both, not just one — issuance-only blocking still leaves already-issued tokens (up to 30 days by default, per `expires_in`) redeemable.

```ts
// In POST /api/v1/admin/organizations/:id/magic-token, after loading `org`
// and before the magic_login_enabled check:
if (org.settings?.enforce_sso) {
  throw new AppError(
    'Magic-login tokens cannot be issued for an SSO-enforced organization',
    403,
    'SsoEnforced'
  );
}
```

```ts
// In auth.ts, POST /auth/magic-login, after loading `org` (org lookup already
// exists in this handler for the magic_login_enabled check) and before
// checking magic_login_enabled:
if (org.settings?.enforce_sso) {
  throw new AppError('Magic login is disabled for this organization', 403, 'SsoEnforced');
}
```

This closes the gap even if `magic_login_enabled` and `enforce_sso` are both left true on the same org (they are independent settings and nothing else prevents that combination).

### `packages/backend/src/api/server.ts`

**Correction to an earlier draft of this spec**, which named `packages/backend/src/api/index.ts` and an `await app.register(oidcRoutes)` call — verified against the source tree and both are wrong. `api/index.ts` is the package's export barrel (re-exports `createServer`/`startServer`/etc. for consumers), not where routes are wired up. Route registration happens in `packages/backend/src/api/server.ts`, and every sibling module uses a direct function call with `(fastify, db)` — not Fastify's plugin `app.register()` — e.g. `authRoutes(fastify, db)`, `billingRoutes(fastify, db)`, `adminOrganizationRoutes(fastify, db)`. Follow the same pattern:

```ts
// In server.ts, alongside the other route registration calls
// (e.g. right after `authRoutes(fastify, db);`):
import { oidcRoutes } from './routes/oidc.js';
// ...
oidcRoutes(fastify, db);
```

### `packages/backend/src/config.ts`

Add selfhosted-mode OIDC env vars. Append inside the env-var mapping block, after the last existing key; exact insertion point depends on the object structure — read the file first.

```ts
// Append after the last existing env-var key:
oidcIssuer:       process.env.OIDC_ISSUER,
oidcClientId:     process.env.OIDC_CLIENT_ID,
oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
```

### `apps/admin/src/hooks/use-sso-config.ts`

New hook for reading and saving tenant IdP config from the admin UI. Verify the base API URL pattern against sibling hooks before using bare `/api/` paths.

Per Constraint 14, `GET /admin/oidc-config` never returns `clientSecret` (only a `hasClientSecret` boolean). `SsoConfig` (the shape read from GET) and `SsoConfigPatch` (the shape sent to PUT) are therefore two different types — the hook must not assume they're the same, unlike the earlier draft of this file.

```ts
// New file:
import { useState, useEffect, useCallback } from 'react';

// Shape returned by GET — never carries the real secret (Constraint 14).
export interface SsoConfig {
  issuerUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  allowedDomains: string[];
  enforceSso: boolean;
}

// Shape sent to PUT. clientSecret is optional: omit/leave blank to keep the
// existing stored secret (the admin UI never has the real value to resubmit).
export interface SsoConfigPatch {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  allowedDomains: string[];
  enforceSso: boolean;
}

export function useSsoConfig() {
  const [config, setConfig] = useState<SsoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/oidc-config', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setConfig)
      .catch(() => setError('Failed to load SSO config'))
      .finally(() => setLoading(false));
  }, []);

  const saveConfig = useCallback(async (patch: SsoConfigPatch): Promise<void> => {
    const r = await fetch('/api/admin/oidc-config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('Failed to save SSO config');
    const saved = await r.json();
    setConfig(saved); // server response, not `patch` — patch may carry a plaintext clientSecret we must not hold in state
  }, []);

  return { config, loading, error, saveConfig };
}
```

### `apps/admin/src/pages/sso-config.tsx`

New page for tenant-admin SSO configuration. Verify page wrapper, layout component names, and i18n hook usage against sibling pages in `apps/admin/src/pages/` before implementing — those conventions are not enumerated in the source tree index.

```tsx
// New file — skeleton; adapt wrapper and i18n to match sibling page conventions:
import React, { useState } from 'react';
import type { SsoConfig, SsoConfigPatch } from '../hooks/use-sso-config.js';
import { useSsoConfig } from '../hooks/use-sso-config.js';

export function SsoConfigPage() {
  const { config, loading, saveConfig } = useSsoConfig();
  // `form` mirrors SsoConfigPatch, not SsoConfig — the secret field here is
  // whatever the admin types (usually blank, meaning "keep existing"), never
  // the real stored secret, which GET never returns (Constraint 14).
  const [form, setForm] = useState<SsoConfigPatch | null>(null);

  // On load, seed form from `config` — leave the clientSecret form field
  // blank; render config.hasClientSecret as a "secret is set" indicator only
  // (e.g. a masked placeholder), never a real value to prefill.
  // On submit, call saveConfig(form). If the clientSecret field was left
  // blank, omit it from the payload entirely so the backend's "keep existing
  // secret if omitted" behavior (Constraint 14) applies — do not send an
  // empty string, which the backend must NOT treat as "keep existing"
  // (indistinguishable from "clear the secret"; omission is the only signal).
  // Fields: issuerUrl, clientId, clientSecret (optional, blank = keep existing),
  // allowedDomains (comma-separated), enforceSso toggle
  // All labels must use i18n keys — add keys to apps/admin/src/i18n/ per CLAUDE.md conventions

  if (loading) return null;
  // render form...
  return <div>{/* implement form here */}</div>;
}
```

### `apps/admin/src/components/auth/` (login form file — exact name to confirm)

The exact login form filename under `apps/admin/src/components/auth/` is not enumerated in the source tree. Identify it, then add the SSO button and conditional password-form suppression:

```tsx
// In the login form component — append SSO button and conditional hide:

// 1. Fetch tenantSsoEnabled from a lightweight endpoint or derive from URL:
//    ASSUMED: a public endpoint or config exists to check if SSO is active for the subdomain tenant

// 2. Conditionally show SSO button:
{tenantSsoEnabled && (
  <a href={`/api/auth/oidc/${tenantSlug}/login`} className="btn-sso">
    {t('auth.signInWithSso')}
  </a>
)}

// 3. Conditionally hide password form (Constraint 7):
{!enforceSso && (
  // existing email + password fields
)}
```

### `apps/admin/src/App.tsx`

Append inside the protected route tree, after the last existing protected route.

```tsx
// Append after the last existing protected route:
<Route
  path="/sso-config"
  element={
    <AdminRoute>
      <SsoConfigPage />
    </AdminRoute>
  }
/>
```

## Tests

### `packages/backend/tests/api/oidc.test.ts`

**Mock/fixture updates required:**

`openid-client` performs live HTTP to the discovery URL and JWKS endpoint; it must be mocked at module level. Verify which HTTP/module mocking strategy sibling test files use (check `packages/backend/tests/api/auth.test.ts` and `packages/backend/tests/api/auth-handlers.test.ts` as references) — if they use `msw` or `nock`, prefer consistency. The example below uses `vi.mock`.

The cache layer must also be mocked; verify the exported class/function name in `packages/backend/src/cache/cache-service.ts` before writing the mock — the name `CacheService` is ASSUMED.

```ts
// At module top level — vi.mock calls must not be inside describe/it:
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn() },
  generators: {
    codeVerifier: vi.fn(() => 'mock-verifier'),
    codeChallenge: vi.fn(() => 'mock-challenge'),
    state: vi.fn(() => 'mock-state'),
    nonce: vi.fn(() => 'mock-nonce'),
  },
}));

// ASSUMED class name — verify against packages/backend/src/cache/cache-service.ts:
vi.mock('../../src/cache/cache-service.js', () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// ASSUMED: buildApp() or equivalent test-app factory exists in the test harness.
// Verify the factory import path and signature against sibling test files before using.
```

**Test case A — OIDC callback happy path issues session cookie (AC #1):**

```ts
import { vi, describe, it, expect } from 'vitest';
import { Issuer } from 'openid-client';

describe('GET /auth/oidc/:tenant/callback — happy path', () => {
  it('issues a session cookie for a valid OIDC code exchange', async () => {
    const mockClaims = {
      iss: 'https://idp.example.com',
      aud: 'client-id',
      nonce: 'mock-nonce',
      exp: Math.floor(Date.now() / 1000) + 300,
      email: 'user@corp.example.com',
      email_verified: true,
    };
    const mockClient = {
      authorizationUrl: vi.fn(() => 'https://idp.example.com/auth'),
      callback: vi.fn(async () => ({ claims: () => mockClaims })),
    };
    vi.mocked(Issuer.discover).mockResolvedValue({ Client: vi.fn(() => mockClient) } as never);

    // Seed Redis mock so state lookup succeeds:
    // cacheService.get.mockResolvedValue({ codeVerifier: 'mock-verifier', nonce: 'mock-nonce', tenantId: 'tenant-uuid' })
    // ASSUMED: inject cacheService mock via app factory or DI override

    // ASSUMED: app = await buildApp({ db: mockDb, cache: mockCache })
    const response = await app.inject({
      method: 'GET',
      url: '/auth/oidc/tenant-slug/callback?code=auth-code&state=mock-state',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['set-cookie']).toBeDefined();
  });
});
```

**Test case B — password login succeeds without SSO config (AC #2):**

```ts
it('POST /auth/login returns 200 when no OIDC config exists for the tenant', async () => {
  // oidcIdpConfigRepo.findByTenantId returns null (no config)
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'user@example.com', password: 'correct-password' },
  });

  expect(response.statusCode).toBe(200);
});
```

**Test case C — password login blocked when SSO enforced (AC #3):**

```ts
it('POST /auth/login returns 403 sso_enforced when tenant enforce_sso is true', async () => {
  // oidcIdpConfigRepo.findByTenantId resolves { enforceSso: true, ... }
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'user@corp.example.com', password: 'any' },
  });

  expect(response.statusCode).toBe(403);
  expect(JSON.parse(response.body)).toMatchObject({ error: 'sso_enforced' });
});
```

**Test case D — invalid ID tokens rejected (AC #4, #5, #6):**

```ts
describe('GET /auth/oidc/:tenant/callback — invalid tokens', () => {
  const cases = [
    {
      label: 'expired exp',
      mutate: (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 60 }),
    },
    {
      label: 'wrong iss',
      mutate: (c: Record<string, unknown>) => ({ ...c, iss: 'https://evil.example.com' }),
    },
    { label: 'wrong aud', mutate: (c: Record<string, unknown>) => ({ ...c, aud: 'wrong-client' }) },
  ];

  for (const { label, mutate } of cases) {
    it(`returns 401 for ${label}`, async () => {
      const badClaims = mutate({
        iss: 'https://idp.example.com',
        aud: 'client-id',
        nonce: 'mock-nonce',
        exp: Math.floor(Date.now() / 1000) + 300,
        email: 'u@corp.example.com',
        email_verified: true,
      });
      // mock client.callback to return badClaims or throw (openid-client throws on many of these)
      // seed cache state as valid

      const response = await app.inject({
        method: 'GET',
        url: '/auth/oidc/tenant-slug/callback?code=code&state=mock-state',
      });

      expect(response.statusCode).toBe(401);
    });
  }

  it('returns 401 for bad signature (openid-client throws)', async () => {
    // mock client.callback to throw an RPError or OPError
    const response = await app.inject({
      method: 'GET',
      url: '/auth/oidc/tenant-slug/callback?code=code&state=mock-state',
    });
    expect(response.statusCode).toBe(401);
  });
});
```

**Test case E — existing user linked, no duplicate created (AC #8):**

```ts
it('links OIDC login to existing user row without creating a duplicate', async () => {
  // userRepo.findByEmail('user@corp.example.com') resolves an existing user { id: 'user-uuid', ... }
  // mock client.callback to return valid claims with email: 'user@corp.example.com'

  const countBefore = await mockDb.users.count();
  await app.inject({
    method: 'GET',
    url: '/auth/oidc/tenant-slug/callback?code=c&state=mock-state',
  });
  const countAfter = await mockDb.users.count();

  expect(countAfter).toBe(countBefore);
});
```

**Test case F — first-time user gets new row (AC #9):**

```ts
it('creates a new user row on first OIDC login when email has no match', async () => {
  // userRepo.findByEmail returns null
  // mock client.callback returns valid claims with email: 'new@corp.example.com'

  const countBefore = await mockDb.users.count();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/oidc/tenant-slug/callback?code=c&state=mock-state',
  });
  const countAfter = await mockDb.users.count();

  expect(response.statusCode).toBe(302);
  expect(countAfter).toBe(countBefore + 1);
});
```

**Test case G — state mismatch returns 400 (AC #7):**

```ts
it('returns 400 when state is not in Redis', async () => {
  // cacheService.get resolves null (state expired or never set)
  const response = await app.inject({
    method: 'GET',
    url: '/auth/oidc/tenant-slug/callback?code=code&state=unknown-state',
  });

  expect(response.statusCode).toBe(400);
});
```

**Test case H — admin OIDC config round-trip, secret never echoed back (AC #10, Constraint 14):**

```ts
it('PUT then GET /admin/oidc-config persists non-secret fields but never echoes clientSecret', async () => {
  const payload = {
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    allowedDomains: ['corp.example.com'],
    enforceSso: false,
  };

  const putRes = await app.inject({
    method: 'PUT',
    url: '/admin/oidc-config',
    headers: { authorization: `Bearer ${adminToken}` }, // adminToken: tenant ORG_MEMBER_ROLE.ADMIN, not just any authenticated user
    payload,
  });
  expect(putRes.statusCode).toBe(200);

  const getRes = await app.inject({
    method: 'GET',
    url: '/admin/oidc-config',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const { clientSecret: _omitted, ...expectedSafeFields } = payload;
  expect(JSON.parse(getRes.body)).toMatchObject(expectedSafeFields);
  expect(JSON.parse(getRes.body)).not.toHaveProperty('clientSecret');
});
```

**Test case I — client secret is never stored in plaintext (AC #11, Constraint 11):**

```ts
it('does not persist the plaintext client_secret in oidc_idp_config', async () => {
  const plaintextSecret = 'super-secret-value';
  await oidcIdpConfigRepo.upsert(tenantId, {
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-id',
    clientSecret: plaintextSecret,
    allowedDomains: [],
    enforceSso: false,
  });

  // Read the raw column directly (bypassing the repository's own decrypt)
  // to prove the stored value is not the plaintext secret.
  const raw = await mockDb.query(
    'SELECT encrypted_client_secret FROM oidc_idp_config WHERE tenant_id = $1',
    [tenantId]
  );
  expect(raw.rows[0].encrypted_client_secret).not.toBe(plaintextSecret);
  expect(raw.rows[0].encrypted_client_secret).not.toContain(plaintextSecret);

  // But the repository's own read path still returns the decrypted value.
  const config = await oidcIdpConfigRepo.findByTenantId(tenantId);
  expect(config?.clientSecret).toBe(plaintextSecret);
});
```

**Test case J — password registration blocked when SSO enforced (AC #12, Constraint 8):**

```ts
it('POST /auth/register returns 403 sso_enforced when tenant enforce_sso is true, even with a valid invite', async () => {
  // oidcIdpConfigRepo.findByTenantId resolves { enforceSso: true, ... } for request.organizationId
  // invitationService.validatePendingToken resolves a valid, matching invitation
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'new@corp.example.com', password: 'any', invite_token: 'valid-token' },
  });

  expect(response.statusCode).toBe(403);
  expect(JSON.parse(response.body)).toMatchObject({ error: 'sso_enforced' });
});
```

**Test case K — magic-login issuance and redemption blocked when SSO enforced (AC #13, Constraint 8):**

```ts
describe('magic-login is blocked for SSO-enforced orgs', () => {
  it('POST /admin/organizations/:id/magic-token returns 403 even when magic_login_enabled is true', async () => {
    // org.settings = { enforce_sso: true, magic_login_enabled: true }
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/magic-token`,
      headers: { authorization: `Bearer ${platformAdminToken}` },
      payload: { user_id: userId },
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /auth/magic-login rejects a pre-existing valid token if the org has since enabled enforce_sso', async () => {
    // token was minted before enforce_sso was turned on; org.settings.enforce_sso is now true
    const response = await app.inject({
      method: 'POST',
      url: '/auth/magic-login',
      payload: { token: preIssuedMagicToken },
    });
    expect(response.statusCode).toBe(403);
  });
});
```

**Test case L — domain allowlist enforced before account linking (AC #14, Constraint 15):**

```ts
it('rejects a verified-email callback whose domain is not in a non-empty allowedDomains list', async () => {
  // IdP config has allowedDomains: ['corp.example.com']
  // mock client.callback returns valid, verified claims with email: 'user@other-domain.example.com'

  const usersBefore = await mockDb.users.count();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/oidc/tenant-slug/callback?code=c&state=mock-state',
  });
  const usersAfter = await mockDb.users.count();

  expect(response.statusCode).toBe(403);
  // No account should be created or linked for a rejected domain.
  expect(usersAfter).toBe(usersBefore);
});
```

**Test case M — SSRF-unsafe issuerUrl rejected before any discovery request (AC #15, Constraint 12):**

```ts
describe('issuerUrl is validated against SSRF targets', () => {
  const unsafeUrls = [
    'http://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
    'http://localhost:6379/', // internal service
    'http://127.0.0.1/',
    'http://[::1]/',
  ];

  for (const issuerUrl of unsafeUrls) {
    it(`rejects PUT /admin/oidc-config with issuerUrl=${issuerUrl}`, async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/admin/oidc-config',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          issuerUrl,
          clientId: 'client-id',
          clientSecret: 'client-secret',
          allowedDomains: [],
          enforceSso: false,
        },
      });
      expect(response.statusCode).toBe(400);
      // Issuer.discover must never have been called for a rejected URL.
      expect(discoverSpy).not.toHaveBeenCalled();
    });
  }
});
```

**Test case N — non-admin tenant member cannot read or write IdP config (AC #16, Constraint 13):**

```ts
describe('/admin/oidc-config requires ORG_MEMBER_ROLE.ADMIN, not just authentication', () => {
  it('GET returns 403 for an authenticated non-admin member', async () => {
    // memberToken belongs to a user with ORG_MEMBER_ROLE.MEMBER in the tenant
    const response = await app.inject({
      method: 'GET',
      url: '/admin/oidc-config',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('PUT returns 403 for an authenticated non-admin member', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/admin/oidc-config',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        issuerUrl: 'https://attacker-controlled-idp.example.com',
        clientId: 'x',
        clientSecret: 'x',
        allowedDomains: [],
        enforceSso: true,
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
```

## Verification

```bash
# Run the new migration (requires Docker stack or a test DB):
pnpm --filter @bugspotter/backend migrate

# Type-check backend (gates CI):
pnpm --filter @bugspotter/backend typecheck

# Run unit tests scoped to the new OIDC file:
pnpm --filter @bugspotter/backend test:unit -- --testPathPattern=oidc

# Run full unit suite to check for regressions:
pnpm --filter @bugspotter/backend test:unit

# Type-check admin UI:
pnpm --filter @bugspotter/admin typecheck
```

Rollback: All backend changes are additive (new table, new routes, new config keys). The enforce-SSO guards in `auth.ts` (`/auth/login`, `/auth/register`) and `admin-organizations.ts` (`/admin/organizations/:id/magic-token`, and the `enforce_sso` check inside `/auth/magic-login`) are only active when a row exists in `oidc_idp_config` with `enforce_sso = true`; removing that row (or dropping the table) restores prior password/magic-login behavior for that tenant. No existing data is mutated. To roll back fully: revert all four guards (`/auth/login`, `/auth/register`, magic-token issuance, magic-login redemption), drop the migration, remove the `oidcRoutes` registration from `api/index.ts`, and remove the `openid-client` dependency.
