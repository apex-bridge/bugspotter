# Spec: SSO config page and login button (admin UI)

Linked issue: Refs #355
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `apps/admin/src/hooks/use-sso-config.ts` (new)
- `apps/admin/src/pages/sso-config.tsx` (new)
- `apps/admin/src/App.tsx` (changed — add `/sso-config` route)
- `apps/admin/src/components/auth/*` — login form component (changed). Exact filename ASSUMED, not verified: the tree lists `apps/admin/src/components/auth` as a directory but does not enumerate its files; confirm the login form's actual filename before implementing.
- `apps/admin/src/i18n/*` — locale key files (changed). Exact path structure ASSUMED, not verified: `apps/admin/src/i18n` appears in the tree as a directory only; follow whatever key layout the existing files use.
- `apps/admin/src/services/*` — API client used by the new hook (changed or reused). ASSUMED, not verified: `apps/admin/src/services` is listed as a directory without enumerated files; confirm whether an existing typed client (e.g. the one `use-integration-config.ts` uses) should be reused rather than hand-rolling `fetch` calls.
- `apps/admin/src/tests/*` — new/updated test files (see Tests section). ASSUMED, not verified: `apps/admin/src/tests` is listed as a directory only.

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

## Constraints

1. The GET response must never surface a real secret value into any form input's `value`/`defaultValue`; only the boolean `hasClientSecret` may drive a "secret is currently set" indicator, per ADR-0044 and the PR #345 fix it references.
2. When the user submits the form without having typed a new secret, the PUT payload must omit the `clientSecret` field entirely (not send `""`), so the backend's "omitted = keep existing" contract (per the issue) is honored. `undefined` and `""` are easy to conflate in form-state serialization — the hook's update payload type must make the field optional, not nullable-string.
3. `/sso-config` client-side gating (tenant-admin only) is a UX affordance, not a security boundary — #354's server-side check is authoritative. The route guard must fail closed (hide the page/route) but the spec doesn't rely on it for anything the backend doesn't already enforce.
4. The login form must resolve the current tenant's `enforce_sso` value before deciding whether to render password fields, to avoid a flash of password UI that's immediately replaced (avoid layout shift and avoid briefly offering a login method the tenant has disabled).
5. i18n keys must follow `apps/admin/CLAUDE.md` conventions (props-only strings into components, no inline literals). The exact existing key-file layout is ASSUMED, not verified here — the source tree only shows `apps/admin/src/i18n` as a directory; match whatever structure the existing locale files use before adding new keys.
6. The SSO config type (issuer URL, client ID, `hasClientSecret`, allowed domains, `enforce_sso`) must be imported from wherever #352 defines it. **Not** `packages/types/src/api-contract.ts` or `packages/types/src/api-types.ts` — both were checked in full and neither currently defines an `SsoConfig`/`SsoConfigUpdate` (or similarly-named) type as of this writing; #352 is a blocking prerequisite and has apparently not landed yet. `SsoConfig`/`SsoConfigUpdate` below are placeholder names — confirm the real export name, shape, and destination file once #352 lands before writing the hook's return type.

## Acceptance criteria

- [ ] GET response is rendered such that no input's `value`/`defaultValue` ever contains a real secret; only a "secret is set" indicator driven by `hasClientSecret` is shown — verified by Test case A
- [ ] Submitting the form without editing the secret field sends a PUT body with `clientSecret` omitted (key absent, not empty string) — verified by Test case B
- [ ] Submitting the form after typing a new secret sends that literal value as `clientSecret` in the PUT body — verified by Test case C
- [ ] The login form always renders a "Sign in with SSO" button regardless of `enforce_sso` — verified by Test case D
- [ ] When the resolved tenant has `enforce_sso: true`, the login form does not render password/credential fields — verified by Test case E
- [ ] When `enforce_sso` is `false` or absent, the login form renders password fields alongside the SSO button — verified by Test case F
- [ ] A user with the tenant-admin role navigating to `/sso-config` sees the config page render — verified by Test case G
- [ ] A user without the tenant-admin role navigating to `/sso-config` is blocked client-side (redirected or shown no route) without depending on a failed API call to discover this — verified by Test case H

## Changes

### `apps/admin/src/hooks/use-sso-config.ts`

New hook, modeled on the fetch/update shape of `use-integration-config.ts`. GET result type carries `hasClientSecret: boolean`, never a secret string; update payload makes `clientSecret` optional so omission is distinguishable from an empty value.

```ts
// New file:
import { useCallback, useEffect, useState } from 'react';
// Placeholder names — #352 has not landed; confirm the real export name/path once it does.
// NOT packages/types/src/api-contract.ts or api-types.ts — checked in full, neither defines this type today.
import type { SsoConfig, SsoConfigUpdate } from '@bugspotter/types';

export function useSsoConfig() {
  const [config, setConfig] = useState<SsoConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      // ASSUMED endpoint path, not verified — confirm against #353
      const res = await fetch('/api/v1/admin/sso-config', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load SSO config: ${res.status}`);
      setConfig(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (payload: SsoConfigUpdate) => {
    // payload.clientSecret is optional — callers must omit the key, not send ''
    const res = await fetch('/api/v1/admin/sso-config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to update SSO config: ${res.status}`);
    setConfig(await res.json());
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, isLoading, error, updateConfig, refetch: fetchConfig };
}
```

### `apps/admin/src/pages/sso-config.tsx`

New page. Naming convention against sibling `pages/` files ASSUMED, not verified — the tree does not enumerate `apps/admin/src/pages` contents; confirm casing/suffix convention (e.g. kebab-case `.tsx`) matches neighbors before creating.

```tsx
// New file:
import { useState } from 'react';
import { useSsoConfig } from '../hooks/use-sso-config';

export default function SsoConfigPage() {
  const { config, isLoading, error, updateConfig } = useSsoConfig();
  const [clientSecretInput, setClientSecretInput] = useState('');

  async function handleSubmit(formValues: {
    issuerUrl: string;
    clientId: string;
    allowedDomains: string[];
    enforceSso: boolean;
  }) {
    await updateConfig({
      ...formValues,
      // omit clientSecret entirely unless the admin typed a new one
      ...(clientSecretInput ? { clientSecret: clientSecretInput } : {}),
    });
  }

  // form JSX omitted — wires formValues + handleSubmit, shows a
  // "secret configured" badge driven by config?.hasClientSecret
}
```

### `apps/admin/src/App.tsx`

Add a protected, tenant-admin-gated route. ASSUMED, not verified — confirm whether `admin-route.tsx` already accepts a role prop suitable for tenant-admin gating, or whether a new guard is needed; the tree does not show `admin-route.tsx`'s contents.

```tsx
// Append to route table, alongside existing admin-gated routes:
<Route
  path="/sso-config"
  element={
    <AdminRoute requiredRole="tenant-admin">
      <SsoConfigPage />
    </AdminRoute>
  }
/>
```

### `apps/admin/src/components/auth/*` (login form — exact filename ASSUMED, not verified)

Add the SSO button and conditionally hide password fields.

```tsx
// Inside the login form component, after resolving tenant enforce_sso:
{!tenant?.enforceSso && (
  // existing password/email fields, unchanged
)}
<Button onClick={handleSsoLogin}>{t('auth.signInWithSso')}</Button>
```

### `apps/admin/src/i18n/*` (ASSUMED path, not verified)

```ts
// Add key, following existing locale-file structure:
// auth.signInWithSso: "Sign in with SSO"
```

## Tests

### `apps/admin/src/tests/use-sso-config.test.ts` (new; exact directory ASSUMED, not verified)

**Mock/fixture updates required:**

```ts
// Mock global fetch for GET/PUT to the SSO config endpoint;
// no existing shared mock covers this endpoint shape, add locally:
global.fetch = vi.fn();
```

**Test case A — GET response never exposes a raw secret (AC #1):**

```ts
it('never populates a secret value from the GET response', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      hasClientSecret: true,
      allowedDomains: [],
      enforceSso: false,
    }),
  } as Response);
  const { result } = renderHook(() => useSsoConfig());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.config).not.toHaveProperty('clientSecret');
  expect(result.current.config?.hasClientSecret).toBe(true);
});
```

**Test case B — omitted secret on PUT (AC #2):**

```ts
it('omits clientSecret from the PUT body when not edited', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
  const { result } = renderHook(() => useSsoConfig());
  await result.current.updateConfig({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    allowedDomains: [],
    enforceSso: false,
  });
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
  expect(body).not.toHaveProperty('clientSecret');
});
```

**Test case C — new secret is sent (AC #3):**

```ts
it('includes clientSecret in the PUT body when provided', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
  const { result } = renderHook(() => useSsoConfig());
  await result.current.updateConfig({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    clientSecret: 'new-secret',
    allowedDomains: [],
    enforceSso: false,
  });
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
  expect(body.clientSecret).toBe('new-secret');
});
```

### `apps/admin/src/tests/login-form.test.tsx` (changed; exact filename ASSUMED, not verified)

**Mock/fixture updates required:**

```ts
// Mock tenant resolution context to control enforceSso per test:
vi.mock('../contexts/auth-context', () => ({
  useAuthContext: () => ({ tenant: { enforceSso: false } }),
}));
```

**Test case D — SSO button always present (AC #4):**

```ts
it('always renders the Sign in with SSO button', () => {
  render(<LoginForm />);
  expect(screen.getByRole('button', { name: /sign in with sso/i })).toBeInTheDocument();
});
```

**Test case E — password fields hidden when enforced (AC #5):**

```ts
it('hides password fields when tenant enforces SSO', () => {
  vi.mocked(useAuthContext).mockReturnValue({ tenant: { enforceSso: true } });
  render(<LoginForm />);
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
});
```

**Test case F — password fields shown when not enforced (AC #6):**

```ts
it('shows password fields when SSO is not enforced', () => {
  vi.mocked(useAuthContext).mockReturnValue({ tenant: { enforceSso: false } });
  render(<LoginForm />);
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});
```

### `apps/admin/src/tests/sso-config-route.test.tsx` (new; exact directory ASSUMED, not verified)

**Test case G — tenant-admin sees the page (AC #7):**

```ts
it('renders SsoConfigPage for a tenant-admin user', () => {
  vi.mocked(useOrgPermissions).mockReturnValue({ role: 'tenant-admin' });
  render(<App />, { route: '/sso-config' });
  expect(screen.getByRole('heading', { name: /sso/i })).toBeInTheDocument();
});
```

**Test case H — non-admin is blocked client-side (AC #8):**

```ts
it('does not render SsoConfigPage for a non-admin user', () => {
  vi.mocked(useOrgPermissions).mockReturnValue({ role: 'member' });
  render(<App />, { route: '/sso-config' });
  expect(screen.queryByRole('heading', { name: /sso/i })).not.toBeInTheDocument();
});
```

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
```

Rollback: revert the new hook/page/route files and the login-form diff. Purely additive client code over already-existing, already-gated (#354) backend endpoints — no backend or data effect to unwind.
