# Spec: SSO 4d/4 SSO config page + route

Linked issue: Refs #409
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `apps/admin/src/pages/organization/org-sso.tsx` (new)
- `apps/admin/src/App.tsx` (changed)
- `apps/admin/src/tests/pages/org-sso.test.tsx` (new)

**Blocking prerequisites:** #407 (Slice 3 — `useSsoConfig()`, `ssoService`) must land and be implemented first; this slice consumes that hook directly.

**Split note:** this is Slice 4 of #355 (Refs #355), split from that issue's combined spec (PR #405, `docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md`) after it was blocked by `check-spec-scope.mjs`'s hard 6-file gate (13 files declared, once every wildcard in the original 7-file draft was grounded against the real admin-app tree, against a 6-file cap). Hand-extracted directly from #405's own already-grounded spec content — not regenerated from scratch, to avoid reintroducing grounding errors already fixed there, same reasoning #367/#368 and #394/#395 used for their splits. Depends on Slice 3 (#407) landing and being implemented first; independent of Slices 1/2 (#406/#408, the login half of this feature).

## Problem

Tenants can configure an OIDC identity provider only via direct API calls today — there is no admin UI page to view or edit SSO settings for an organization. Tenant admins have no usable UI path for this action.

## Out of scope

- The SSO config data layer (`sso-service.ts`, `use-sso-config.ts`) — that is #407 (this slice only consumes it).
- Login-page SSO status and UI — that is #406/#408.
- Backend endpoint implementation for reading/writing SSO config (#353).
- Backend RBAC/tenant-admin gating for those endpoints (#354) — not yet merged; this slice's client-side gate is a UX affordance only, not a substitute for it.
- Backend validation of the config shape itself (#352).
- The actual OIDC redirect/callback flow — not touched by this slice.
- Any change to `bugspotter-sdk`, `bugspotter-extension`, or `bugspotter-landing`.

## Constraints

1. `/my-organization/sso` client-side gating (tenant-admin only) is a UX affordance, not a security boundary — #354's server-side check is the authoritative one, but #354 is not yet merged. The gate must fail closed (hide the settings form) regardless, and this spec doesn't rely on the backend enforcing anything beyond what #354 will cover once it lands.
2. **There is no `<AdminRoute requiredRole="...">` prop.** `apps/admin/src/components/admin-route.tsx` is a hardcoded `user?.role !== 'admin'` check with no `requiredRole` parameter — a route sketch using that prop doesn't compile against anything that exists. Billing, intelligence, and legal-details — the closest per-organization settings pages to this one — nest under `/my-organization/*` behind `OrgRoute` (which only checks `hasOrganization`, not role); `org-retention.tsx` is a _platform_-admin page routed at `organizations/retention` under `AdminRoute`, not `/my-organization/*`, so it isn't a precedent here despite the similar name. None of billing/intelligence/legal-details actually hides its whole page body behind a role check today: `org-billing.tsx` uses `useOrgPermissions().canManageBilling` only to hide specific buttons (cancel/upgrade), `org-intelligence.tsx` does no role check at all, and `org-legal-details.tsx` uses `currentOrganization?.my_role === 'owner'` to toggle a `readOnly` state on already-rendered inputs rather than blocking rendering. The `isSystemAdmin || orgRole === 'admin' || orgRole === 'owner'` boolean is real and already computed in `use-onboarding-status.ts:52`, but there it gates quick-action CTA visibility, not a whole page — this SSO page is the first to use that formula as a whole-page fail-closed gate. That's the right call here (the form surfaces a client secret indicator), it just isn't an existing page-level convention to lean on. ADR-0044 confirms the backend gate is `requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)` — a minimum-role check, not an exact-match "tenant-admin" role string, so `orgRole === 'admin' || orgRole === 'owner'` is still the correct client-side mirror.
3. The page must resolve `usePermissions()` before deciding whether to render the form, and fail closed (render nothing) rather than depending on a failed API call to discover the user lacks access. This also means the `useSsoConfig()` query itself must not fire for an unauthorized user just because the hook was called — React always runs a component's hooks regardless of an early return later in the same render, so `useSsoConfig()` must accept an `enabled` option (the same gating shape `use-onboarding-status.ts` already uses via `enabled: canConfigure && hasOrganization`), and this page must pass `enabled: canManageSso && !isLoadingPermissions`. #407's hook signature as currently spec'd doesn't expose that option — this is an additional requirement on #407 this slice depends on, beyond what's written there today.
4. The GET response's rendering must never surface a real secret value into any form input's `value`/`defaultValue`; only the boolean `hasClientSecret` (from #407's data layer) may drive a "secret is currently set" indicator, per ADR-0044 and the PR #345 fix it references.
5. When the user submits the form without having typed a new secret, the submitted payload must omit the `clientSecret` field entirely (not send `""`) — the page's own submit handler must not defeat #407's optional-field contract by coercing an empty string.

## Acceptance criteria

- [ ] A user with an org role of `admin` or `owner` navigating to `/my-organization/sso` sees the config form render — verified by Test case G
- [ ] A user with org role `member` navigating to `/my-organization/sso` does not see the config form, without depending on a failed API call to discover this — verified by Test case H

## Changes

### `apps/admin/src/pages/organization/org-sso.tsx` (new)

Corrected path and route family — the original spec's flat `pages/sso-config.tsx` at a top-level `/sso-config` route doesn't match how any comparable org-scoped settings page in this codebase is organized. `org-billing.tsx`, `org-intelligence.tsx`, and `org-legal-details.tsx` live under `pages/organization/org-*.tsx` and are routed at `my-organization/*`; `org-retention.tsx` is a platform-admin page under `pages/platform/`, not the same family. The role gate is done inline via `usePermissions()`, the same `isSystemAdmin || orgRole === 'admin' || orgRole === 'owner'` boolean `use-onboarding-status.ts` already computes — not a route-wrapper prop, since `AdminRoute` has no such prop and `OrgRoute` only checks org membership, not role. Unlike `org-billing.tsx`/`org-intelligence.tsx` (which render for any org member and only gate individual actions), this page fails closed on its whole body because the form exposes a client-secret indicator.

```tsx
import { useState } from 'react';
import { usePermissions } from '../../hooks/use-permissions';
import { useSsoConfig } from '../../hooks/use-sso-config';

export default function OrgSsoPage() {
  const { isSystemAdmin, orgRole, isLoading: isLoadingPermissions } = usePermissions();
  const canManageSso = isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';

  // enabled gate: hooks always run even though the component returns
  // null below for a non-admin, so the query itself — not just the
  // rendered form — must stay disabled until permissions resolve and
  // the user is authorized. Requires useSsoConfig() (#407) to accept
  // an `enabled` option; see Constraint 3.
  const { config, isLoading, error, updateConfig } = useSsoConfig({
    enabled: canManageSso && !isLoadingPermissions,
  });
  const [clientSecretInput, setClientSecretInput] = useState('');

  if (isLoadingPermissions) {
    return null;
  }
  if (!canManageSso) {
    // Fails closed without an API round trip — orgRole/isSystemAdmin
    // come from the already-resolved usePermissions() query, and the
    // useSsoConfig() query above never fired for this user.
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

Add the route inside the existing `my-organization/*` block (alongside `my-organization/billing`, `my-organization/intelligence`, etc.), wrapped in `OrgRoute` exactly like its siblings — not a new top-level `AdminRoute requiredRole=...` route, which doesn't correspond to anything that exists in `admin-route.tsx` today.

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

## Tests

### `apps/admin/src/tests/pages/org-sso.test.tsx` (new)

Corrected from the original spec's `sso-config-route.test.tsx`, which rendered `<App />` at a route to test gating — no existing page test in this codebase does that (checked all of `tests/pages/`). The established pattern (`org-billing.test.tsx`) instead renders the page component directly and mocks the permission hook to assert conditional rendering, which covers both the "admin sees it" and "non-admin doesn't" cases in one file instead of a separate route-level test.

**Test case G — admin/owner sees the config form (AC #1):**

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

**Test case H — member does not see the config form (AC #2):**

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

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
```

Rollback: revert the new `org-sso.tsx` page, the route addition in `App.tsx`, and remove the new test file. Purely additive over the backend endpoints #354 will gate once merged — no backend or data effect to unwind.
