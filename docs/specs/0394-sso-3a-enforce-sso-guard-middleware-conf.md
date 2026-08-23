# Spec: SSO 3a/4 `enforce_sso` guard middleware + config plumbing

Linked issue: Refs #394
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/api/middleware/enforce-sso.ts` (new)
- `packages/backend/tests/api/middleware/enforce-sso.test.ts` (new — direct unit test of the guard's branching logic, mocking the repository, not going through a Fastify server)
- `packages/backend/src/config.ts` (add `OIDC_ENFORCE_SSO` selfhosted-mode flag, per CLAUDE.md: "Flags that depend on mode are declared in `packages/backend/src/config.ts`")
- `packages/backend/src/config/types.ts` (add field to the config type)
- `packages/backend/tests/config.test.ts`

**Blocking prerequisites:** #352 — adds the `oidc_idp_config` repository this guard reads from in `saas` mode; the guard cannot resolve a tenant's `enforce_sso` value without it.

**Split note:** this is half A of #354 (Refs #354), split from that issue's combined spec (PR #392) after it was blocked by `check-spec-scope.mjs`'s hard 6-file gate (10 files declared against a 6-file cap). Hand-extracted directly from PR #392's own already-drafted spec content, then corrected against a direct review of the real merged #352 code (see "Corrections from #392" below) - not regenerated from scratch, to avoid reintroducing grounding errors and another spec-agent timeout (same reasoning #367/#368's split from #353 used). Half B (wiring the guard onto live endpoints) is #395, and depends on this issue.

**Corrections from #392's original combined spec**, found during review of PR #392 (Copilot) and independently verified here against the real merged `#352` code:

1. The repository accessor on `DatabaseClient` is `db.oidcIdpConfigs`, not `db.oidcIdpConfigRepository` — confirmed at `packages/backend/src/db/client.ts:221` (`this.oidcIdpConfigs = this.wrapWithRetry(repositories.oidcIdpConfigs)`). #392's spec had the wrong accessor name in three places (the guard's own parameter naming, and twice in #395's wiring code — fixed there too).
2. `OidcIdpConfigRepository.findByTenantId` returns `enforceSso` (camelCase), not `enforce_sso` (snake_case) — confirmed at `packages/backend/src/db/repositories/oidc-idp-config.repository.ts:99` (`enforceSso: row.enforce_sso`): the repository maps the DB row's snake_case column to a camelCase field before returning it. #392's spec read `idpConfig?.enforce_sso`, which would silently never match and never enforce SSO in `saas` mode - fixed below.
3. `packages/backend/src/config/validators.ts` already exports `parseBooleanEnv(value: string | undefined): boolean | undefined` (used with nullish-coalescing: `parseBooleanEnv(env) ?? defaultValue`, per its own doc comment) - #392's spec invented a new `parseBoolEnv(value, defaultValue)` helper instead of using it. Dropped from this spec's file list entirely: nothing needs to change in `validators.ts`, only import and call the existing function.
4. Added a direct unit test for the guard itself (`enforce-sso.test.ts`) - #392's spec had no test exercising `assertSsoNotEnforced`'s own branching (selfhosted vs. saas mode, repository call, error throw) in isolation; its only coverage came indirectly through #395's endpoint-level tests, which don't fully isolate the guard's own logic from Fastify/DB wiring.

## Problem

Four auth surfaces can currently establish a session for a user whose organization has SSO enforced, silently bypassing the SSO requirement (see #395 for the endpoint list and wiring). Per ADR-0044 Decision 4, the enforcement logic itself needs to exist and be fully unit-tested in isolation before it's wired onto any live endpoint — this half builds exactly that: a shared guard function and the config plumbing it reads from, with zero endpoint changes.

## Out of scope

- Applying the guard to any live endpoint (`/auth/login`, `/auth/register`, `/auth/magic-login`, `/admin/organizations/:id/magic-token`) — that is #395.
- Implementing the `oidc_idp_config` repository itself — that is #352 (already merged).
- The `saas`-mode config-lookup service/caching layer — that is #353; this guard only needs the repository to exist, not the service.
- The OIDC provider integration or login flow itself (token exchange, callback handling, account linking) — covered elsewhere under #265.
- Any admin UI surfacing of `enforce_sso` status — not requested by this issue.
- Work in `bugspotter-sdk`, `bugspotter-extension`, `bugspotter-mcp`, `bugspotter-landing`, or `bugspotter-deploy` — none of the affected files live outside `bugspotter-public`.

## Constraints

1. Guard must read `enforce_sso` from the mode-appropriate source per ADR-0044 Decision 4: the tenant's `oidc_idp_config` row in `saas` mode (via `db.oidcIdpConfigs.findByTenantId`, reading the returned `enforceSso` field), the `OIDC_ENFORCE_SSO` env var in `selfhosted` mode.
2. Must default to **not enforced** when the config source is absent/unset (missing `oidc_idp_config` row, or `OIDC_ENFORCE_SSO` unset) — the issue explicitly requires this default over throwing. This applies only to an absent/unset config _value_, not to a failed lookup: if `oidcIdpConfigs.findByTenantId` itself throws (DB connection error, etc.), the guard must let that exception propagate rather than swallow it into `enforceSso: false` — a failed auth request is the correct fail-closed outcome for a security guard, versus silently treating an infrastructure error as "SSO not required."
3. The deployment-mode branch must match `getDeploymentConfig()`'s own default (`packages/backend/src/saas/config.ts:33-36`: unset/unrecognized `DEPLOYMENT_MODE` resolves to `selfhosted`) and the pattern the rest of `config.ts` already uses (lines 104, 109: `process.env.DEPLOYMENT_MODE === 'saas'`) — branch on `=== 'saas'` for the DB-lookup path, with `selfhosted` (including unset/invalid) as the fallthrough default, not the other way around.
4. This slice only consumes the `oidc_idp_config` repository from #352 — it must not implement repository methods itself.
5. Change must be purely additive/behind-config: with nothing calling the guard yet (that's #395's job), these additions have zero runtime effect on any existing behavior.
6. `SsoEnforcedError`'s carried identifier (its message, `'sso_enforced'`) is the single shared source #395 constructs its `403 {"error":"sso_enforced"}` responses from — keep it stable, since #395 depends on this exact value across all four endpoints for a consistent response shape.
7. Use the existing `parseBooleanEnv` from `config/validators.ts` for the `OIDC_ENFORCE_SSO` env var — do not add a new boolean-env-parsing helper.

## Acceptance criteria

- [ ] `assertSsoNotEnforced` throws `SsoEnforcedError` in `selfhosted` mode when `config.oidc.enforceSso` is `true` — verified by Test H
- [ ] `assertSsoNotEnforced` resolves without throwing in `selfhosted` mode when `config.oidc.enforceSso` is `false` — verified by Test I
- [ ] `assertSsoNotEnforced` throws `SsoEnforcedError` in `saas` mode when `db.oidcIdpConfigs.findByTenantId` resolves an object with `enforceSso: true` — verified by Test J
- [ ] `assertSsoNotEnforced` resolves without throwing in `saas` mode when the repository resolves `null` or `enforceSso: false` — verified by Test K (both outcomes)
- [ ] `assertSsoNotEnforced` propagates the original error, unmodified, when `db.oidcIdpConfigs.findByTenantId` rejects in `saas` mode — verified by Test L
- [ ] In `selfhosted` mode, an unset `OIDC_ENFORCE_SSO` env var results in `config.oidc.enforceSso` resolving to `false` (no error thrown) — verified by Test G
- [ ] In `selfhosted` mode, `OIDC_ENFORCE_SSO=true` results in `config.oidc.enforceSso` resolving to `true` — verified by Test G
- [ ] When `DEPLOYMENT_MODE` is unset or unrecognized, `assertSsoNotEnforced` takes the `selfhosted` path (does not call `findByTenantId`) — verified by Test M

## Changes

### `packages/backend/src/api/middleware/enforce-sso.ts`

New shared guard function, to be called from each of the four handlers in #395; resolves the enforcement flag per deployment mode and throws the standard error on block.

**Correction:** the deployment-mode check below must not read `config.deploymentMode` — that field does not exist on `AppConfig` (`packages/backend/src/config/types.ts` has no `deploymentMode`, and `config.ts` never assigns one). Every other mode-dependent default in `config.ts` (e.g. `auth.allowRegistration`, `auth.selfServiceSignupEnabled`) reads `process.env.DEPLOYMENT_MODE` directly — do the same here, or use `getDeploymentConfig()` from `../../saas/config.js` (already imported by `auth.ts`) if a richer accessor is needed. Confirmed: `getDeploymentConfig()` returns `{ mode: DeploymentMode; features: DeploymentFeatures }` (`packages/backend/src/saas/config.ts:21-24`), so `.mode` is available there if needed — the guard below still reads `process.env.DEPLOYMENT_MODE` directly, matching the rest of `config.ts`.

**Correction (review):** branch on `=== 'saas'`, not `=== 'selfhosted'`. `getDeploymentConfig()` (`packages/backend/src/saas/config.ts:33-36`) resolves an unset or unrecognized `DEPLOYMENT_MODE` to `selfhosted`, and `config.ts` (lines 104, 109) mirrors that by checking `=== 'saas'` for saas-only defaults. A guard that instead checks `=== 'selfhosted'` and falls through to the DB lookup on anything else inverts that default: an unset `DEPLOYMENT_MODE` would hit the `saas` repository-lookup path instead of the `selfhosted` env-var path. The DB-lookup branch must be the explicit `=== 'saas'` check, with `selfhosted` as the fallthrough.

```ts
// New file
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
```

### `packages/backend/src/config.ts`

**Correction:** the `oidc` section already exists in `config.ts` (it currently holds `redirectBaseUrl`) — add `enforceSso` alongside it, don't gate this on "create the section if none exists." Use the existing `parseBooleanEnv` with nullish-coalescing, per that function's own documented usage pattern - not a newly-invented helper.

```ts
// Add to the existing `oidc` section of the config object:
oidc: {
  redirectBaseUrl: process.env.OIDC_REDIRECT_BASE_URL?.trim().replace(/\/+$/, '') || null,
  enforceSso: parseBooleanEnv(process.env.OIDC_ENFORCE_SSO) ?? false,
},
```

### `packages/backend/src/config/types.ts`

**Correction:** `AppConfig` already declares `oidc: OidcConfig;`, and `OidcConfig` already exists with a `redirectBaseUrl: string | null` field — add `enforceSso` to that existing interface rather than treating `oidc` as a new root field.

```ts
// Add to the existing OidcConfig interface:
export interface OidcConfig {
  redirectBaseUrl: string | null;
  enforceSso: boolean;
}
```

## Tests

### `packages/backend/tests/api/middleware/enforce-sso.test.ts`

Direct unit test of `assertSsoNotEnforced` - mocks `OidcIdpConfigRepository` directly (a plain object with a mocked `findByTenantId`), no Fastify server, no real database. Isolates the guard's own mode-branching and error-throwing from any endpoint wiring (that's #395's job to test).

**Correction (review):** all four cases (H/I/J/K) belong in a single `describe` block so they share `beforeEach`/`afterEach` env-var setup and reset, and so `mockRepo` is declared once instead of leaking between snippets. `process.env.DEPLOYMENT_MODE`/`OIDC_ENFORCE_SSO` are captured and restored in `afterEach`, following the existing pattern in `packages/backend/tests/config.test.ts:9-20` and `packages/backend/tests/db/user-repository-org-filter.test.ts` — mutating `process.env` without restoring it leaks state into unrelated tests.

**Test cases H/I/J/K/L/M — all modes:**

```ts
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
```

### `packages/backend/tests/config.test.ts`

**Test case G — `OIDC_ENFORCE_SSO` resolves `config.oidc.enforceSso` correctly in `selfhosted` mode, both set and unset:**

**Correction:** there is no `loadConfig()` export — `config.ts` exports a `config` const evaluated at import time. Every other test in this file re-reads it via `vi.resetModules()` + dynamic `import()`; follow that pattern.

```ts
it('defaults oidc.enforceSso to false when OIDC_ENFORCE_SSO is unset', async () => {
  process.env.DEPLOYMENT_MODE = 'selfhosted';
  delete process.env.OIDC_ENFORCE_SSO;
  vi.resetModules();

  const { config } = await import('../src/config.js');

  expect(config.oidc.enforceSso).toBe(false);
});

it('exposes oidc.enforceSso=true from OIDC_ENFORCE_SSO=true in selfhosted mode', async () => {
  process.env.DEPLOYMENT_MODE = 'selfhosted';
  process.env.OIDC_ENFORCE_SSO = 'true';
  vi.resetModules();

  const { config } = await import('../src/config.js');

  expect(config.oidc.enforceSso).toBe(true);
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit
```

Rollback: revert the `enforce-sso.ts` middleware file, its test, the `config.ts`/`config/types.ts` additions, and the added assertions in `config.test.ts` (they assert `config.oidc.enforceSso`, which no longer exists once the config change is reverted). All steps are additive and inert (default `false`, called by nothing) until #395 wires the guard into a live endpoint — no data migration or irreversible state change is introduced.
