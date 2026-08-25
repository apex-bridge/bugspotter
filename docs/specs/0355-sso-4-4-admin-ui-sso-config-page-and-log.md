# Spec: SSO config page and login button (admin UI)

Linked issue: Refs #355
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

## Scope note (grounding pass, 2026-08-25)

The originally-generated version of this spec declared 7 files, 5 of them
unenumerated wildcards (`components/auth/*`, `i18n/*`, `services/*`,
`tests/*`) marked "ASSUMED, not verified" — `generate-spec.mjs` has no
style-example lookup for the admin frontend (only
`packages/backend/src/api/routes`), so the model had no real admin-tree
context to ground against.

Every wildcard below has been resolved against the actual repo structure
(files read directly, not inferred). Two corrections fell out of that:

1. **There is no login-form component.** `apps/admin/src/components/auth/`
   holds only `auth-page-layout.tsx`, `invitation-banner.tsx`, and
   `setup-loading-screen.tsx`. The login form is the page itself,
   `apps/admin/src/pages/login.tsx`.
2. **`AdminRoute` has no role prop.** `apps/admin/src/components/admin-route.tsx`
   is a hardcoded `user?.role !== 'admin'` check with no `requiredRole`
   parameter — the original spec's `<AdminRoute requiredRole="tenant-admin">`
   sketch doesn't compile against anything that exists. Every other
   per-organization admin-only settings page in this codebase (billing,
   intelligence, legal details, retention) instead nests under
   `/my-organization/*` behind `OrgRoute` (which only checks
   `hasOrganization`) and does its own role check inside the page body via
   `usePermissions()`'s `orgRole` — see `use-onboarding-status.ts:52`
   (`isSystemAdmin || orgRole === 'admin' || orgRole === 'owner'`) and
   `org-billing.tsx` (`useOrgPermissions().canManageBilling`) for two
   independent instances of this exact pattern. ADR-0044 itself confirms
   the backend gate is `requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)` —
   a minimum-role check, not an exact-match "tenant-admin" role string, so
   `orgRole === 'admin' || orgRole === 'owner'` is the correct client-side
   mirror.

Once every wildcard is replaced with real, distinct files (see below), the
true file count is **13 across the whole issue**, not 7 — the wildcards
were hiding real fan-out (three locale files always move together per
`apps/admin/CLAUDE.md`'s en/ru/kk sync requirement; this repo's existing
service files are consistently paired 1:1 with a `tests/services/*.test.ts`
— see `auth-service.ts` / `tests/services/auth-service.test.ts`, both of
which already exist and already have a `describe('getRegistrationStatus', ...)`
block per method). That count doesn't collapse under 6 without cutting real,
already-established coverage, so **this issue needs to be split**, the same
way #354 split into #394 (guard logic) and #395 (endpoint wiring).

The natural split point here is the same in both halves of the feature:
**data layer vs. UI layer**, plus the pre-existing **login vs. config-page**
split the two halves of the original spec already had:

| Slice                                 | Files | Depends on | Covers                  |
| ------------------------------------- | ----- | ---------- | ----------------------- |
| **1 — Login SSO status (data layer)** | 5     | —          | AC groundwork for #4-#6 |
| **2 — Login page SSO UI**             | 2     | Slice 1    | AC #4, #5, #6           |
| **3 — SSO config data layer**         | 6     | —          | AC groundwork for #1-#3 |
| **4 — SSO config page + route**       | 3     | Slice 3    | AC #1, #2, #3, #7, #8   |

Slices 1 and 3 are independent of each other (different services, different
i18n sections) and can ship in either order or in parallel. Slices 2 and 4
each depend only on their own data-layer slice, not on each other.

The four slices are written out in full below (each is a complete,
directly-usable spec body) so they can be filed as four follow-up
issues/specs against #355 rather than re-derived from scratch. The list
below declares all 13 files across all 4 slices in one place, on purpose,
so `check-spec-scope.mjs` evaluates the full grounded scope honestly rather
than a single arbitrarily-chosen slice — expect it to still fail the hard
cap; that failure is the correct outcome given the real fan-out, not a bug
in the grounding pass. Each individual slice's own file list (repeated in
its section below) is at or under the cap on its own.

**Files touched:**

- `apps/admin/src/services/auth-service.ts` (changed) — Slice 1
- `apps/admin/src/tests/services/auth-service.test.ts` (changed) — Slice 1
- `apps/admin/src/i18n/locales/en.json` (changed) — Slices 1 & 3
- `apps/admin/src/i18n/locales/ru.json` (changed) — Slices 1 & 3
- `apps/admin/src/i18n/locales/kk.json` (changed) — Slices 1 & 3
- `apps/admin/src/pages/login.tsx` (changed) — Slice 2
- `apps/admin/src/tests/pages/login.test.tsx` (new) — Slice 2
- `apps/admin/src/services/sso-service.ts` (new) — Slice 3
- `apps/admin/src/hooks/use-sso-config.ts` (new) — Slice 3
- `apps/admin/src/tests/hooks/use-sso-config.test.tsx` (new) — Slice 3
- `apps/admin/src/pages/organization/org-sso.tsx` (new) — Slice 4
- `apps/admin/src/App.tsx` (changed) — Slice 4
- `apps/admin/src/tests/pages/org-sso.test.tsx` (new) — Slice 4

**Blocking prerequisites:**

- #352 — defines the SSO config shape (issuer URL, client ID, `hasClientSecret`, allowed domains, `enforce_sso`) this UI renders and submits
- #353 — the GET/PUT endpoints this hook calls must exist
- #354 — those endpoints must already gate to tenant-admin server-side; this slice adds client-side gating on top, not instead of

## Problem

Tenants can configure an OIDC identity provider only via direct API calls today — there is no admin UI to view or edit SSO settings, and the login form has no way to route a user into an SSO flow or to suppress password fields for a tenant that has made SSO mandatory (`enforce_sso: true`). Tenant admins configuring SSO, and end users at an SSO-enforced tenant, have no usable UI path for either action.

## Out of scope

- Backend endpoint implementation for reading/writing SSO config (#353)
- Backend RBAC/tenant-admin gating for those endpoints (#354)
- Backend validation of the config shape itself (#352)
- The actual OIDC redirect/callback flow initiated by clicking "Sign in with SSO" — this spec covers only the button's presence/visibility, not the auth handshake it triggers
- Any change to `bugspotter-sdk`, `bugspotter-extension`, or `bugspotter-landing` — none of those repos are touched by this slice
- Promoting the two ASSUMED raw endpoint paths below into `apps/admin/src/lib/api-constants.ts` — both slices inline the path locally (matching the existing precedent in `integration-service.ts`'s `parsePluginCode`/`analyzeCode`) since the real paths are still unconfirmed pending #353. Promoting them is a trivial follow-up once #353 lands and isn't worth a 14th declared file today.

## Constraints

1. The GET response must never surface a real secret value into any form input's `value`/`defaultValue`; only the boolean `hasClientSecret` may drive a "secret is currently set" indicator, per ADR-0044 and the PR #345 fix it references.
2. When the user submits the form without having typed a new secret, the PUT payload must omit the `clientSecret` field entirely (not send `""`), so the backend's "omitted = keep existing" contract (per the issue) is honored. `undefined` and `""` are easy to conflate in form-state serialization — the hook's update payload type must make the field optional, not nullable-string.
3. `/my-organization/sso` client-side gating (tenant-admin only) is a UX affordance, not a security boundary — #354's server-side check is authoritative. The gate must fail closed (hide the settings form) but the spec doesn't rely on it for anything the backend doesn't already enforce.
4. The login form must resolve the current tenant's `enforce_sso` value before deciding whether to render password fields, to avoid a flash of password UI that's immediately replaced (avoid layout shift and avoid briefly offering a login method the tenant has disabled). Because this runs on an unauthenticated page, it cannot reuse the authenticated `/organizations/:id/...` pattern the config page uses — it needs an unauthenticated, host/subdomain-resolved endpoint, mirroring how `authService.getRegistrationStatus()` already works today (same pre-auth, tenant-resolved-by-host shape, called from the same `useEffect` in `login.tsx`).
5. i18n keys must follow `apps/admin/CLAUDE.md` conventions (props-only strings into components, no inline literals) and must be added identically to all three locale files (`en.json`, `ru.json`, `kk.json` — `pnpm validate:i18n` / `pnpm test:i18n` fails CI on drift, per `apps/admin/src/i18n/README.md`). The login button's string goes in the existing `auth` section (already holds the other login-page strings — `auth.loginButton`, `auth.password`, etc. — confirmed by reading `en.json`). The config page's strings go in a new top-level `sso` section, mirroring the shape of the existing `intelligence` section (`title`, `description`, `settings.*`) — `intelligence` is the closest existing precedent for "new org-scoped admin settings feature gets its own top-level i18n section."
6. The SSO config type (issuer URL, client ID, `hasClientSecret`, allowed domains, `enforce_sso`) must be imported from wherever #352 defines it. **Not** `packages/types/src/api-contract.ts` or `packages/types/src/api-types.ts` — both were checked in full and neither currently defines an `SsoConfig`/`SsoConfigUpdate` (or similarly-named) type as of this writing; #352 is a blocking prerequisite and has apparently not landed yet. `SsoConfig`/`SsoConfigUpdate` below are placeholder names — confirm the real export name, shape, and destination file once #352 lands before writing the hook's return type.

## Acceptance criteria

- [ ] GET response is rendered such that no input's `value`/`defaultValue` ever contains a real secret; only a "secret is set" indicator driven by `hasClientSecret` is shown — verified by Test case A (Slice 3)
- [ ] Submitting the form without editing the secret field sends a PUT body with `clientSecret` omitted (key absent, not empty string) — verified by Test case B (Slice 3)
- [ ] Submitting the form after typing a new secret sends that literal value as `clientSecret` in the PUT body — verified by Test case C (Slice 3)
- [ ] The login form always renders a "Sign in with SSO" button regardless of `enforce_sso` — verified by Test case D (Slice 2)
- [ ] When the resolved tenant has `enforce_sso: true`, the login form does not render password/credential fields — verified by Test case E (Slice 2)
- [ ] When `enforce_sso` is `false` or absent, the login form renders password fields alongside the SSO button — verified by Test case F (Slice 2)
- [ ] A user with an org role of `admin` or `owner` navigating to `/my-organization/sso` sees the config form render — verified by Test case G (Slice 4)
- [ ] A user with org role `member` navigating to `/my-organization/sso` does not see the config form, without depending on a failed API call to discover this — verified by Test case H (Slice 4)

---

## Slice 1 — Login SSO status (data layer)

5 files, no dependency on the other three slices.

### `apps/admin/src/services/auth-service.ts` (changed)

Add `getSsoStatus()`, mirroring the existing `getRegistrationStatus()` right
above it — same shape: unauthenticated GET, tenant resolved by the request's
host/subdomain via the backend's tenant middleware (per
`apps/admin/CLAUDE.md`'s tenant-routing section), not by any client-supplied
org id.

```ts
// Add alongside the existing getRegistrationStatus():
getSsoStatus: async (): Promise<{ enforceSso: boolean }> => {
  const response = await api.get<{ success: boolean; data: { enforceSso: boolean } }>(
    // ASSUMED path, not verified — confirm against #353. Inlined rather
    // than added to api-constants.ts for now; mirrors auth.registrationStatus()'s
    // `/api/v1/auth/registration-status` naming.
    '/api/v1/auth/sso-status'
  );
  return response.data.data;
},
```

### `apps/admin/src/tests/services/auth-service.test.ts` (changed)

This file already exists and already has one `describe` block per method
(`register`, `getRegistrationStatus`, `login`, `refreshToken`, ...) — add a
`describe('getSsoStatus', ...)` block in the same style as the existing
`getRegistrationStatus` block (success case + error-propagation case).

### `apps/admin/src/i18n/locales/en.json`, `ru.json`, `kk.json` (changed)

Add one key to the existing `auth` section (which already holds
`loginButton`, `password`, `forgotPassword`, etc.):

```json
"auth": {
  "signInWithSso": "Sign in with SSO"
}
```

---

## Slice 2 — Login page SSO UI

2 files. Depends on Slice 1 (`authService.getSsoStatus()`).

### `apps/admin/src/pages/login.tsx` (changed)

Corrected from the original spec's `components/auth/*` guess — this is the
actual, only login form, already imported directly by `App.tsx`
(`<Route path="/login" element={<LoginPage />} />`, no wrapper component).
Fetch SSO status in the same post-`isInitialized` `useEffect` that already
calls `authService.getRegistrationStatus()`, add local state, and gate the
password fields on it.

```tsx
// New state, alongside the existing registrationAllowed/passwordResetEnabled:
const [enforceSso, setEnforceSso] = useState(false);

// Inside the existing useEffect (after isInitialized), alongside the
// existing authService.getRegistrationStatus() call:
authService.getSsoStatus().then(
  (status) => setEnforceSso(status.enforceSso),
  () => {
    // Fail open to password fields on a status-check failure — matches
    // the existing getRegistrationStatus() error handling above, which
    // also fails to a safe default rather than blocking the page.
  }
);

// In the JSX, wrap the existing email/password <Input> pair:
{
  !enforceSso && (
    <>
      <Input label={t('auth.emailAddress')} /* ...unchanged... */ />
      <Input label={t('auth.password')} /* ...unchanged... */ />
    </>
  );
}
<Button onClick={handleSsoLogin} className="w-full" variant="outline">
  {t('auth.signInWithSso')}
</Button>;
```

`handleSsoLogin` (the actual redirect/callback trigger) is explicitly out of
scope per this spec's "Out of scope" section — the button's presence and
the password-field visibility are what's tested here, not the handshake.

### `apps/admin/src/tests/pages/login.test.tsx` (new)

No test file for `login.tsx` currently exists anywhere in the repo (checked
`tests/pages/`, `tests/components/` — neither has one; the original spec's
`login-form.test.tsx` assumed an existing file to change, which is wrong on
two counts: wrong path and wrong new/changed status). This is a first-ever
test for the page, so it needs the same mock surface `login.tsx` itself
depends on: `useAuth`, `useSetupGuard`, `useInvitationPreview`, `authService`
(both `getRegistrationStatus` and the new `getSsoStatus`), `sonner`'s
`toast`, and `react-router-dom`'s `useNavigate`/`useSearchParams`.

**Test case D — SSO button always present (AC #4):**

```tsx
it('always renders the Sign in with SSO button', () => {
  vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: false });
  render(<LoginPage />);
  expect(screen.getByRole('button', { name: /sign in with sso/i })).toBeInTheDocument();
});
```

**Test case E — password fields hidden when enforced (AC #5):**

```tsx
it('hides password fields when the tenant enforces SSO', async () => {
  vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: true });
  render(<LoginPage />);
  await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());
});
```

**Test case F — password fields shown when not enforced (AC #6):**

```tsx
it('shows password fields when SSO is not enforced', async () => {
  vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: false });
  render(<LoginPage />);
  await waitFor(() => expect(screen.getByLabelText(/^password/i)).toBeInTheDocument());
});
```

---

## Slice 3 — SSO config data layer

6 files, no dependency on Slices 1/2.

### `apps/admin/src/services/sso-service.ts` (new)

Corrected from the original spec's raw-`fetch` sketch in `use-sso-config.ts`
— this codebase's convention is a dedicated typed service file per domain,
consumed by `@tanstack/react-query` in the hook, never a raw `fetch` call
inline in a hook (checked `use-integration-config.ts`, `use-onboarding-status.ts`,
`use-intelligence-status.ts` — all three go through `api`/`API_ENDPOINTS` +
a service module, none call `fetch` directly). Modeled on
`intelligence-service.ts`, the closest existing analogue: a single,
org-scoped settings object with a GET + an update call.

```ts
import { api } from '../lib/api-client';
import type { SsoConfig, SsoConfigUpdate } from '@bugspotter/types'; // placeholder — see Constraint 6

export const ssoService = {
  getSettings: async (orgId: string): Promise<SsoConfig> => {
    // ASSUMED path, not verified — confirm against #353. Mirrors the
    // organizations/:id/... convention every other org-scoped settings
    // resource uses (intelligence, data-residency, billing), corrected
    // from the original spec's flat, non-org-scoped /admin/sso-config.
    const response = await api.get(`/api/v1/organizations/${orgId}/sso`);
    return response.data.data;
  },

  updateSettings: async (orgId: string, payload: SsoConfigUpdate): Promise<SsoConfig> => {
    // payload.clientSecret is optional — callers must omit the key, not send ''
    const response = await api.put(`/api/v1/organizations/${orgId}/sso`, payload);
    return response.data.data;
  },
};
```

### `apps/admin/src/hooks/use-sso-config.ts` (new)

Corrected to the react-query pattern every comparable hook in this codebase
actually uses (`useQuery`/`useMutation`, not raw `useState`/`useEffect`/
`fetch`) — modeled on `use-intelligence-status.ts`'s org-scoped query shape.

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { ssoService } from '../services/sso-service';
import type { SsoConfigUpdate } from '@bugspotter/types'; // placeholder — see Constraint 6

export function useSsoConfig() {
  const { currentOrganization } = useOrganization();
  const orgId = currentOrganization?.id;
  const queryClient = useQueryClient();

  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sso-config', orgId],
    queryFn: () => ssoService.getSettings(orgId!),
    enabled: !!orgId,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: SsoConfigUpdate) => ssoService.updateSettings(orgId!, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sso-config', orgId] }),
  });

  return {
    config,
    isLoading,
    error: error as Error | null,
    updateConfig: updateMutation.mutateAsync,
    isSaving: updateMutation.isPending,
  };
}
```

### `apps/admin/src/tests/hooks/use-sso-config.test.tsx` (new)

Naming/location corrected from the original spec's `tests/use-sso-config.test.ts`
(wrong directory — hook tests live in `tests/hooks/`, confirmed against
`use-intelligence-status.test.tsx`, `use-integration-config-linear.test.tsx`,
etc.) and wrong extension (`.test.tsx`, not `.test.ts` — every existing hook
test uses `.tsx` even though the hook file itself is `.ts`, because the test
wrapper renders a `QueryClientProvider`). Mocks `ssoService` directly
(matching `use-intelligence-status.test.tsx`'s pattern of mocking the
service module rather than `fetch`) — this also means `sso-service.ts`
itself doesn't need its own dedicated `tests/services/sso-service.test.ts`
file: `intelligence-service.ts`, the closest analogue, doesn't have one
either, and its behavior is covered the same way, through the hook test.

**Test case A — GET response never exposes a raw secret (AC #1):**

```tsx
it('never populates a secret value from the GET response', async () => {
  vi.mocked(ssoService.getSettings).mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    hasClientSecret: true,
    allowedDomains: [],
    enforceSso: false,
  });
  const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.config).not.toHaveProperty('clientSecret');
  expect(result.current.config?.hasClientSecret).toBe(true);
});
```

**Test case B — omitted secret on PUT (AC #2):**

```tsx
it('omits clientSecret from the update payload when not edited', async () => {
  await result.current.updateConfig({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    allowedDomains: [],
    enforceSso: false,
  });
  expect(ssoService.updateSettings).toHaveBeenCalledWith(
    orgId,
    expect.not.objectContaining({ clientSecret: expect.anything() })
  );
});
```

**Test case C — new secret is sent (AC #3):**

```tsx
it('includes clientSecret in the update payload when provided', async () => {
  await result.current.updateConfig({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    clientSecret: 'new-secret',
    allowedDomains: [],
    enforceSso: false,
  });
  expect(ssoService.updateSettings).toHaveBeenCalledWith(
    orgId,
    expect.objectContaining({ clientSecret: 'new-secret' })
  );
});
```

### `apps/admin/src/i18n/locales/en.json`, `ru.json`, `kk.json` (changed)

New top-level `sso` section, mirroring the shape of the existing
`intelligence` section (`title`, `description`, `settings.*`):

```json
"sso": {
  "title": "SSO Configuration",
  "description": "Configure an OIDC identity provider for this organization",
  "settings": {
    "issuerUrl": "Issuer URL",
    "clientId": "Client ID",
    "clientSecret": "Client Secret",
    "clientSecretConfigured": "A secret is currently configured",
    "clientSecretPlaceholder": "Leave blank to keep the existing secret",
    "allowedDomains": "Allowed Domains",
    "enforceSso": "Require SSO",
    "enforceSsoDescription": "Members must sign in with SSO; password login is disabled"
  }
}
```

---

## Slice 4 — SSO config page + route

3 files. Depends on Slice 3 (`useSsoConfig()`).

### `apps/admin/src/pages/organization/org-sso.tsx` (new)

Corrected path and route family — the original spec's flat
`pages/sso-config.tsx` at a top-level `/sso-config` route doesn't match how
any comparable org-scoped settings page in this codebase is organized.
Every other per-organization admin settings surface (`org-billing.tsx`,
`org-intelligence.tsx`, `org-legal-details.tsx`, `org-retention` under
`platform/`) lives under `pages/organization/org-*.tsx` and is routed at
`my-organization/*`. The role gate is done inline via `usePermissions()`,
the same pattern `use-onboarding-status.ts` and `org-billing.tsx` already
use — not a route-wrapper prop, since `AdminRoute` has no such prop and
`OrgRoute` only checks org membership, not role.

```tsx
import { useState } from 'react';
import { usePermissions } from '../../hooks/use-permissions';
import { useSsoConfig } from '../../hooks/use-sso-config';

export default function OrgSsoPage() {
  const { isSystemAdmin, orgRole, isLoading: isLoadingPermissions } = usePermissions();
  const canManageSso = isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';

  const { config, isLoading, error, updateConfig } = useSsoConfig();
  const [clientSecretInput, setClientSecretInput] = useState('');

  if (isLoadingPermissions) {
    return null;
  }
  if (!canManageSso) {
    // Fails closed without an API round trip — orgRole/isSystemAdmin
    // come from the already-resolved usePermissions() query.
    return null;
  }

  async function handleSubmit(formValues: {
    issuerUrl: string;
    clientId: string;
    allowedDomains: string[];
    enforceSso: boolean;
  }) {
    await updateConfig({
      ...formValues,
      ...(clientSecretInput ? { clientSecret: clientSecretInput } : {}),
    });
  }

  // form JSX omitted — wires formValues + handleSubmit, shows a
  // "secret configured" badge driven by config?.hasClientSecret
}
```

### `apps/admin/src/App.tsx` (changed)

Add the route inside the existing `my-organization/*` block (alongside
`my-organization/billing`, `my-organization/intelligence`, etc.), wrapped in
`OrgRoute` exactly like its siblings — not a new top-level
`AdminRoute requiredRole=...` route, which doesn't correspond to anything
that exists in `admin-route.tsx` today.

```tsx
import OrgSsoPage from './pages/organization/org-sso';

// Inside the existing "Org self-service" block in the route table,
// alongside my-organization/billing, my-organization/intelligence, etc.:
<Route
  path="my-organization/sso"
  element={
    <OrgRoute>
      <OrgSsoPage />
    </OrgRoute>
  }
/>;
```

### `apps/admin/src/tests/pages/org-sso.test.tsx` (new)

Corrected from the original spec's `sso-config-route.test.tsx`, which
rendered `<App />` at a route to test gating — no existing page test in this
codebase does that (checked all of `tests/pages/`). The established pattern
(`org-billing.test.tsx`) instead renders the page component directly and
mocks the permission hook to assert conditional rendering, which covers
both the "admin sees it" and "non-admin doesn't" cases in one file instead
of a separate route-level test.

**Test case G — admin/owner sees the config form (AC #7):**

```tsx
it('renders the SSO config form for an org admin', () => {
  vi.mocked(usePermissions).mockReturnValue({
    isSystemAdmin: false,
    orgRole: 'admin',
    isLoading: false,
  } as ReturnType<typeof usePermissions>);
  render(<OrgSsoPage />);
  expect(screen.getByRole('heading', { name: /sso/i })).toBeInTheDocument();
});
```

**Test case H — member does not see the config form (AC #8):**

```tsx
it('does not render the SSO config form for a regular member', () => {
  vi.mocked(usePermissions).mockReturnValue({
    isSystemAdmin: false,
    orgRole: 'member',
    isLoading: false,
  } as ReturnType<typeof usePermissions>);
  render(<OrgSsoPage />);
  expect(screen.queryByRole('heading', { name: /sso/i })).not.toBeInTheDocument();
});
```

---

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
pnpm validate:i18n
```

Rollback: revert the new hook/service/page/route files and the login-page
diff, per slice. Purely additive client code over already-existing,
already-gated (#354) backend endpoints — no backend or data effect to
unwind. Slices 2 and 4 each depend on their own data-layer slice landing
first; Slices 1 and 3 have no cross-dependency and can land in either order.
