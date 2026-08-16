# Spec: SSO / OIDC Login

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #265
ADR: pending

**Files touched:**

- `packages/backend/package.json` (add `openid-client` dependency)
- `packages/backend/src/db/migrations/NNNN_add_oidc_idp_config.sql` (new; replace NNNN with next sequential number in the migrations directory)
- `packages/backend/src/db/repositories/oidc-idp-config.repository.ts` (new)
- `packages/backend/src/db/repositories.ts` (export new repository)
- `packages/backend/src/api/routes/oidc.ts` (new)
- `packages/backend/src/api/routes/auth.ts` (add enforce-SSO guard to password-login handler)
- `packages/backend/src/api/schemas/oidc.schema.ts` (new)
- `packages/backend/src/api/index.ts` (register OIDC route plugin)
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
4. CSRF state and nonce must survive the browser redirect round-trip in Redis via the existing cache layer (`packages/backend/src/cache/cache-service.ts`); TTL ≤ 10 minutes. The exact write/read method signatures on `CacheService` are ASSUMED not verified from the source tree — implementer must read `cache-service.ts` before writing the handler.
5. ID-token validation must verify `iss`, `aud`, `nonce`, `exp`, and the JWKS-backed signature using `openid-client` v5 (FAPI-certified, actively maintained). Custom JOSE parsing is not permitted.
6. Account-linking rule: the ID-token `email` claim is trusted only when `email_verified: true`; it is matched case-insensitively against `users.email`. Match → link the existing row (no new user created). No match → create a new user row (create-on-first-login). This rule must appear verbatim in the ADR.
7. In `saas` mode, IdP config is stored per-tenant in `oidc_idp_config` (one row per org, enforced by `UNIQUE (tenant_id)`). In `selfhosted` mode, env vars `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` configure a single global IdP; no DB row is required for v1.
8. When a tenant has `enforce_sso = true`, the existing `POST /auth/login` endpoint must return HTTP 403 `{"error":"sso_enforced"}` for that tenant's users. The admin UI login form must hide the password fields and show only the SSO button when the tenant's IdP config has `enforce_sso` set.
9. `COOKIE_DOMAIN` must be forwarded to the same `setCookie` call used by the existing login handler so cross-subdomain sessions continue to work in `saas` mode (see `apps/admin/CLAUDE.md`).
10. The migration must use `CREATE TABLE IF NOT EXISTS` (idempotent), consistent with the repo migration convention.

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
- [ ] `PUT /admin/oidc-config` with a valid body persists the config; a subsequent `GET /admin/oidc-config` returns the same values — verified by test case H.

## Changes

### `packages/backend/src/db/migrations/NNNN_add_oidc_idp_config.sql`

New migration. Replace `NNNN` with the next unused sequence number in the migrations directory.

```sql
-- New file:
CREATE TABLE IF NOT EXISTS oidc_idp_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  issuer_url      TEXT        NOT NULL,
  client_id       TEXT        NOT NULL,
  client_secret   TEXT        NOT NULL,
  allowed_domains TEXT[]      NOT NULL DEFAULT '{}',
  enforce_sso     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);
```

### `packages/backend/src/db/repositories/oidc-idp-config.repository.ts`

New repository. Follows the pattern of sibling files in `packages/backend/src/db/repositories/`. The `DatabaseClient` type and `.query()` signature are ASSUMED from the common pg pattern — verify against `packages/backend/src/db/client.ts` before using.

```ts
// New file:
import type { DatabaseClient } from '../client.js';

export interface OidcIdpConfig {
  id: string;
  tenantId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  allowedDomains: string[];
  enforceSso: boolean;
}

export class OidcIdpConfigRepository {
  constructor(private readonly db: DatabaseClient) {} // ASSUMED: DatabaseClient has .query()

  async findByTenantId(tenantId: string): Promise<OidcIdpConfig | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id, tenant_id, issuer_url, client_id, client_secret, allowed_domains, enforce_sso
         FROM oidc_idp_config WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async upsert(
    tenantId: string,
    patch: Omit<OidcIdpConfig, 'id' | 'tenantId'>
  ): Promise<OidcIdpConfig> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO oidc_idp_config
         (tenant_id, issuer_url, client_id, client_secret, allowed_domains, enforce_sso)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         issuer_url      = EXCLUDED.issuer_url,
         client_id       = EXCLUDED.client_id,
         client_secret   = EXCLUDED.client_secret,
         allowed_domains = EXCLUDED.allowed_domains,
         enforce_sso     = EXCLUDED.enforce_sso,
         updated_at      = NOW()
       RETURNING *`,
      [
        tenantId,
        patch.issuerUrl,
        patch.clientId,
        patch.clientSecret,
        patch.allowedDomains,
        patch.enforceSso,
      ]
    );
    return mapRow(result.rows[0]);
  }
}

function mapRow(row: Record<string, unknown>): OidcIdpConfig {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    issuerUrl: row.issuer_url as string,
    clientId: row.client_id as string,
    clientSecret: row.client_secret as string,
    allowedDomains: row.allowed_domains as string[],
    enforceSso: row.enforce_sso as boolean,
  };
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

const STATE_TTL_SECONDS = 600;

export async function oidcRoutes(app: FastifyInstance): Promise<void> {
  // GET /auth/oidc/:tenant/login
  app.get<{ Params: { tenant: string } }>('/auth/oidc/:tenant/login', async (request, reply) => {
    const { tenant } = request.params;
    // 1. Load OidcIdpConfig for tenant from OidcIdpConfigRepository
    //    ASSUMED: repository is available via request.server or DI — verify injection pattern
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
      // 4. tokenSet = await client.callback(redirectUri, { code }, { code_verifier: stateData.codeVerifier, state, nonce: stateData.nonce })
      //    openid-client throws on exp/iss/aud/nonce/sig failures — catch and return 401
      // 5. claims = tokenSet.claims()
      //    if (!claims.email_verified) return reply.status(401).send({ error: 'email_not_verified' })
      // 6. user = await userRepo.findByEmail(claims.email.toLowerCase()) ?? await userRepo.create({ email: claims.email, ... })
      // 7. Issue refresh-token cookie using the same helper as password login (ASSUMED — verify in auth.ts)
      //    Honor COOKIE_DOMAIN (Constraint 9)
      // 8. reply.redirect('/dashboard')
    }
  );

  // GET /admin/oidc-config — tenant admin reads own IdP config
  app.get(
    '/admin/oidc-config',
    { onRequest: [app.authenticate] }, // ASSUMED: verify auth prehandler name against sibling routes
    async (request, reply) => {
      // Load and return config for request.user.tenantId
    }
  );

  // PUT /admin/oidc-config — tenant admin saves IdP config
  app.put(
    '/admin/oidc-config',
    {
      onRequest: [app.authenticate],
      schema: { body: oidcConfigBodySchema },
    },
    async (request, reply) => {
      // Upsert config for request.user.tenantId, return saved row
    }
  );
}
```

### `packages/backend/src/api/routes/auth.ts`

Add the enforce-SSO guard inside the existing `POST /auth/login` handler, after the tenant is resolved and before credential verification. Exact insertion point depends on how the handler is structured — read the file and insert immediately after the tenant resolution block.

```ts
// Append after tenant resolution, before password verification:
const idpConfig = await oidcIdpConfigRepo.findByTenantId(resolvedTenantId);
if (idpConfig?.enforceSso) {
  return reply.status(403).send({ error: 'sso_enforced' });
}
```

`oidcIdpConfigRepo` must be injected consistently with how other repositories are accessed in the same handler. Verify the injection pattern before editing.

### `packages/backend/src/api/index.ts`

Register the OIDC route plugin. Append after the last existing `app.register()` call; adjust the import style to match the file's existing convention (static import at top vs. inline).

```ts
// Append after the last existing route registration:
import { oidcRoutes } from './routes/oidc.js';
// ...
await app.register(oidcRoutes);
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

```ts
// New file:
import { useState, useEffect, useCallback } from 'react';

export interface SsoConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
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

  const saveConfig = useCallback(async (patch: SsoConfig): Promise<void> => {
    const r = await fetch('/api/admin/oidc-config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('Failed to save SSO config');
    setConfig(patch);
  }, []);

  return { config, loading, error, saveConfig };
}
```

### `apps/admin/src/pages/sso-config.tsx`

New page for tenant-admin SSO configuration. Verify page wrapper, layout component names, and i18n hook usage against sibling pages in `apps/admin/src/pages/` before implementing — those conventions are not enumerated in the source tree index.

```tsx
// New file — skeleton; adapt wrapper and i18n to match sibling page conventions:
import React, { useState } from 'react';
import type { SsoConfig } from '../hooks/use-sso-config.js';
import { useSsoConfig } from '../hooks/use-sso-config.js';

export function SsoConfigPage() {
  const { config, loading, saveConfig } = useSsoConfig();
  const [form, setForm] = useState<SsoConfig | null>(null);

  // On load, seed form from config
  // On submit, call saveConfig(form) and show success/error toast
  // Fields: issuerUrl, clientId, clientSecret, allowedDomains (comma-separated), enforceSso toggle
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

**Test case H — admin OIDC config round-trip (AC #10):**

```ts
it('PUT then GET /admin/oidc-config persists and returns the config', async () => {
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
    headers: { authorization: `Bearer ${adminToken}` },
    payload,
  });
  expect(putRes.statusCode).toBe(200);

  const getRes = await app.inject({
    method: 'GET',
    url: '/admin/oidc-config',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  expect(JSON.parse(getRes.body)).toMatchObject(payload);
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

Rollback: All backend changes are additive (new table, new routes, new config keys). The enforce-SSO guard in `auth.ts` is only active when a row exists in `oidc_idp_config`; dropping the table or removing the row restores password-login behavior. No existing data is mutated. To roll back: revert the `auth.ts` guard, drop the migration, remove the `oidcRoutes` registration from `api/index.ts`, and remove the `openid-client` dependency.
