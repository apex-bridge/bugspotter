# Spec: SSO 4a/4 Login SSO status (data layer)

Linked issue: Refs #406
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `apps/admin/src/services/auth-service.ts` (changed)
- `apps/admin/src/tests/services/auth-service.test.ts` (changed)
- `apps/admin/src/i18n/locales/en.json` (changed)
- `apps/admin/src/i18n/locales/ru.json` (changed)
- `apps/admin/src/i18n/locales/kk.json` (changed)

**Blocking prerequisites:** #414 — the `GET /api/v1/auth/sso-status` endpoint this slice's service method calls does not exist yet in the backend. It was briefly folded into this slice's own scope, but that pushed the file count to 7, over `check-spec-scope.mjs`'s hard 6-file cap, so it has been split out into its own small, standalone issue (#414, PR #415) that this slice depends on instead. #354's server-side `enforce_sso` gating is already merged and unaffected by this dependency. See Constraint 3 and Out of scope below.

**Split note:** this is Slice 1 of #355 (Refs #355), split from that issue's combined spec (PR #405, `docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md`) after it was blocked by `check-spec-scope.mjs`'s hard 6-file gate (13 files declared, once every wildcard in the original 7-file draft was grounded against the real admin-app tree, against a 6-file cap). Hand-extracted directly from #405's own already-grounded spec content — not regenerated from scratch, to avoid reintroducing grounding errors already fixed there, same reasoning #367/#368 and #394/#395 used for their splits. This is the smaller, independent half backing the login page's SSO awareness: no dependency on the other three slices beyond #414 above. Slice 2 (#408, the login page UI itself) depends on this one landing and being implemented first. Slice 3 (#407, the config data layer) is independent of this slice.

## Problem

The login form has no way to know whether the current tenant has made SSO mandatory (`enforce_sso: true`), so it cannot yet decide whether to show or hide password fields, or resolve that decision before first paint. This slice adds the read path: an unauthenticated service method the login page (#408) can call to resolve that flag before rendering.

## Out of scope

- Wiring this method into the login page's UI (fields, button, `useEffect` call) — that is #408.
- The SSO config data layer (`sso-service.ts`, `use-sso-config.ts`) — that is #407.
- The SSO config page and its route — that is #409.
- Backend endpoint implementation for this status read — that is #414, this slice's blocking prerequisite; this slice's call target matches #414's specified route contract exactly, not a guess.
- Backend RBAC/tenant-admin gating (#354, already merged) and backend validation of the config shape (#352).
- The actual OIDC redirect/callback flow — this issue only covers the button's presence/visibility in #408, not the auth handshake it triggers.
- Any change to `bugspotter-sdk`, `bugspotter-extension`, or `bugspotter-landing`.

## Constraints

1. This method must be **unauthenticated** and resolve the tenant by request host/subdomain via the backend's tenant middleware (per `apps/admin/CLAUDE.md`'s tenant-routing section), not by any client-supplied org id — it runs on the pre-login page, before any session exists. This mirrors how `authService.getRegistrationStatus()` already works today (same pre-auth, tenant-resolved-by-host shape).
2. i18n keys must follow `apps/admin/CLAUDE.md` conventions (props-only strings into components, no inline literals) and must be added identically to all three locale files (`en.json`, `ru.json`, `kk.json` — `pnpm validate:i18n` / `pnpm test:i18n` fails CI on drift, per `apps/admin/src/i18n/README.md`). The login button's string goes in the existing `auth` section (already holds the other login-page strings — `auth.loginButton`, `auth.password`, etc.).
3. The endpoint path this method calls (`/api/v1/auth/sso-status`) matches #414's specified route contract, not a guess — #414's spec (`docs/specs/0414-sso-add-get-api-v1-auth-sso-status-endpo.md`) fully grounds the route's public/unauthenticated shape and response shape (`{ success, data: { enforceSso: boolean }, timestamp }`). It is inlined directly in the service call rather than promoted to `apps/admin/src/lib/api-constants.ts`, matching the existing precedent in `integration-service.ts`'s `parsePluginCode`/`analyzeCode` (both slices in this split inline their own paths locally for the same reason).

## Acceptance criteria

- [ ] `authService.getSsoStatus()` resolves `{ enforceSso: boolean }` from an unauthenticated GET, tenant resolved by host/subdomain — verified by the new `getSsoStatus` describe block's success case in `auth-service.test.ts`
- [ ] `authService.getSsoStatus()` propagates a rejected request as an error rather than swallowing it — verified by the same describe block's error-propagation case
- [ ] The `auth.signInWithSso` key exists identically in `en.json`, `ru.json`, and `kk.json` — verified by `pnpm validate:i18n`

## Changes

### `apps/admin/src/services/auth-service.ts` (changed)

Add `getSsoStatus()`, mirroring the existing `getRegistrationStatus()` right above it — same shape: unauthenticated GET, tenant resolved by the request's host/subdomain via the backend's tenant middleware, not by any client-supplied org id.

```ts
// Add alongside the existing getRegistrationStatus():
getSsoStatus: async (): Promise<{ enforceSso: boolean }> => {
  const response = await api.get<{ success: boolean; data: { enforceSso: boolean } }>(
    // Path matches #414's specified route contract (backend endpoint,
    // tracked separately as this slice's blocking prerequisite). Inlined
    // rather than added to api-constants.ts; mirrors auth.registrationStatus()'s
    // `/api/v1/auth/registration-status` naming.
    '/api/v1/auth/sso-status'
  );
  return response.data.data;
},
```

### `apps/admin/src/i18n/locales/en.json`, `ru.json`, `kk.json` (changed)

Add one key to the existing `auth` section (which already holds `loginButton`, `password`, `forgotPassword`, etc.):

```json
"auth": {
  "signInWithSso": "Sign in with SSO"
}
```

## Tests

### `apps/admin/src/tests/services/auth-service.test.ts` (changed)

This file already exists and already has one `describe` block per method (`register`, `getRegistrationStatus`, `login`, `refreshToken`, ...) — add a `describe('getSsoStatus', ...)` block in the same style as the existing `getRegistrationStatus` block: one success case asserting the resolved `{ enforceSso }` shape, one error-propagation case asserting a rejected request surfaces as a thrown/rejected error rather than being swallowed.

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
pnpm validate:i18n
```

Rollback: revert the `getSsoStatus()` addition to `auth-service.ts`, its test block, and the three locale-file key additions. Purely additive — nothing yet calls this method (that's #408's job), so reverting has zero effect on any existing behavior.
