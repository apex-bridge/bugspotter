# Spec: SSO 4c/4 SSO config data layer

Linked issue: Refs #407
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `apps/admin/src/services/sso-service.ts` (new)
- `apps/admin/src/hooks/use-sso-config.ts` (new)
- `apps/admin/src/tests/hooks/use-sso-config.test.tsx` (new)
- `apps/admin/src/i18n/locales/en.json` (changed)
- `apps/admin/src/i18n/locales/ru.json` (changed)
- `apps/admin/src/i18n/locales/kk.json` (changed)

**Blocking prerequisites:**

- #352 — defines the SSO config shape (issuer URL, client ID, `hasClientSecret`, allowed domains, `enforceSso`) this data layer renders and submits
- #353 — the GET/PUT endpoints this service/hook call must exist
- #354 — those endpoints must already gate to tenant-admin server-side (already merged); this slice's page (#409) adds client-side gating on top, not instead of

**Split note:** this is Slice 3 of #355 (Refs #355), split from that issue's combined spec (PR #405, `docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md`) after it was blocked by `check-spec-scope.mjs`'s hard 6-file gate (13 files declared, once every wildcard in the original 7-file draft was grounded against the real admin-app tree, against a 6-file cap). Hand-extracted directly from #405's own already-grounded spec content — not regenerated from scratch, to avoid reintroducing grounding errors already fixed there, same reasoning #367/#368 and #394/#395 used for their splits. This slice is independent of Slice 1 (#406, login data layer) — different services, different i18n sections, no shared code beyond the three locale files both touch. Slice 4 (#409, the config page + route) depends on this slice landing and being implemented first.

## Problem

Tenants can configure an OIDC identity provider only via direct API calls today — there is no typed client-side data layer to read or write SSO settings for an organization. Tenant admins configuring SSO have no usable data path for either action; the config page (#409) needs this layer to exist before it can render anything.

## Out of scope

- The SSO config page itself and its route — that is #409.
- Login-page SSO status (data layer) — that is #406; login-page UI wiring — that is #408.
- Backend endpoint implementation for reading/writing SSO config (#353).
- Backend RBAC/tenant-admin gating for those endpoints (#354, already merged).
- Backend validation of the config shape itself (#352).
- The actual OIDC redirect/callback flow — not touched by this slice at all.
- Any change to `bugspotter-sdk`, `bugspotter-extension`, or `bugspotter-landing`.
- Promoting the ASSUMED raw endpoint path below into `apps/admin/src/lib/api-constants.ts` — inlined locally for now (matching the existing precedent in `integration-service.ts`'s `parsePluginCode`, which hardcodes its endpoint path directly rather than going through `API_ENDPOINTS`) since the real path is still unconfirmed pending #353.

## Constraints

1. The GET response must never surface a real secret value into any form input's `value`/`defaultValue`; only the boolean `hasClientSecret` may drive a "secret is currently set" indicator, per ADR-0044 and the PR #345 fix it references. This data layer's job is to keep that boolean-only contract intact end to end — the config type never carries a raw `clientSecret` field on read.
2. When the caller updates config without having supplied a new secret, the update payload must omit the `clientSecret` field entirely (not send `""`), so the backend's "omitted = keep existing" contract (per #355) is honored. `undefined` and `""` are easy to conflate in payload construction — the hook's update payload type must make the field optional, not nullable-string.
3. The hook must be built on `@tanstack/react-query` (`useQuery`/`useMutation`) consuming a dedicated service module, not a raw `fetch`/`useState`/`useEffect` combination in the hook itself. This codebase's comparable data hooks (`use-integration-config.ts`, `use-onboarding-status.ts`, `use-intelligence-status.ts`) all go through `api`/`API_ENDPOINTS` plus a service module; none call `fetch` directly.
4. The SSO config type (issuer URL, client ID, `hasClientSecret`, allowed domains, `enforceSso`) must be imported from wherever #352 defines it. **Not** `packages/types/src/api-contract.ts` or `packages/types/src/api-types.ts` — both were checked in full and neither currently defines an `SsoConfig`/`SsoConfigUpdate` (or similarly-named) type as of this writing; #352 is a blocking prerequisite and has apparently not landed yet. `SsoConfig`/`SsoConfigUpdate` below are placeholder names — confirm the real export name, shape, and destination file once #352 lands before writing the hook's return type.
5. i18n keys must follow `apps/admin/CLAUDE.md` conventions and must be added identically to all three locale files (`en.json`, `ru.json`, `kk.json` — `pnpm validate:i18n` / `pnpm test:i18n` fails CI on drift). The config page's strings go in a new top-level `sso` section, mirroring the shape of the existing `intelligence` section (`title`, `description`, `settings.*`) — `intelligence` is the closest existing precedent for "new org-scoped admin settings feature gets its own top-level i18n section."
6. `sso-service.ts` does not need its own dedicated `tests/services/sso-service.test.ts` file: `intelligence-service.ts`, the closest analogue, doesn't have one either, and its behavior is covered the same way, through the hook test (below) mocking the service module directly.

## Acceptance criteria

- [ ] GET response is rendered such that no result ever contains a real secret; only a "secret is set" indicator driven by `hasClientSecret` is exposed — verified by Test case A
- [ ] Calling `updateConfig` without a new secret sends an update payload with `clientSecret` omitted (key absent, not empty string) — verified by Test case B
- [ ] Calling `updateConfig` with a new secret sends that literal value as `clientSecret` in the update payload — verified by Test case C

## Changes

### `apps/admin/src/services/sso-service.ts` (new)

Corrected from the original spec's raw-`fetch` sketch that had lived inline in the hook — this codebase's convention is a dedicated typed service file per domain, consumed by `@tanstack/react-query` in the hook, never a raw `fetch` call inline in a hook (checked `use-integration-config.ts`, `use-onboarding-status.ts`, `use-intelligence-status.ts` — all three go through `api`/`API_ENDPOINTS` + a service module, none call `fetch` directly). Modeled on `intelligence-service.ts`, the closest existing analogue: a single, org-scoped settings object with a GET + an update call.

```ts
import { api } from '../lib/api-client';
import type { SsoConfig, SsoConfigUpdate } from '@bugspotter/types'; // placeholder — see Constraint 4

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

Corrected to the react-query pattern every comparable hook in this codebase actually uses (`useQuery`/`useMutation`, not raw `useState`/`useEffect`/`fetch`) — modeled on `use-intelligence-status.ts`'s org-scoped query shape.

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { ssoService } from '../services/sso-service';
import type { SsoConfigUpdate } from '@bugspotter/types'; // placeholder — see Constraint 4

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

### `apps/admin/src/i18n/locales/en.json`, `ru.json`, `kk.json` (changed)

New top-level `sso` section, mirroring the shape of the existing `intelligence` section (`title`, `description`, `settings.*`):

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

## Tests

### `apps/admin/src/tests/hooks/use-sso-config.test.tsx` (new)

Location and extension corrected from the original spec's `tests/use-sso-config.test.ts` (wrong directory — hook tests live in `tests/hooks/`, confirmed against `use-intelligence-status.test.tsx`, `use-integration-config-linear.test.tsx`, etc.) and wrong extension (`.test.tsx`, not `.test.ts` — every existing hook test uses `.tsx` even though the hook file itself is `.ts`, because the test wrapper renders a `QueryClientProvider`). Mocks `useOrganization` and `ssoService` directly (matching `use-intelligence-status.test.tsx`'s pattern of mocking the org context and the service module rather than `fetch`).

Shared setup (mirrors `use-intelligence-status.test.tsx`):

```tsx
vi.mock('../../contexts/organization-context', () => ({
  useOrganization: vi.fn(),
}));
vi.mock('../../services/sso-service', () => ({
  ssoService: { getSettings: vi.fn(), updateSettings: vi.fn() },
}));

const orgId = 'org-sso-test';

beforeEach(() => {
  vi.mocked(useOrganization).mockReset();
  vi.mocked(ssoService.getSettings).mockReset();
  vi.mocked(ssoService.updateSettings).mockReset();
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: orgId },
  } as unknown as ReturnType<typeof useOrganization>);
});
```

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

**Test case B — omitted secret on update (AC #2):**

```tsx
it('omits clientSecret from the update payload when not edited', async () => {
  vi.mocked(ssoService.getSettings).mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    hasClientSecret: false,
    allowedDomains: [],
    enforceSso: false,
  });
  vi.mocked(ssoService.updateSettings).mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    hasClientSecret: false,
    allowedDomains: [],
    enforceSso: false,
  });
  const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  await result.current.updateConfig({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    allowedDomains: [],
    enforceSso: false,
  });
  const [, payload] = vi.mocked(ssoService.updateSettings).mock.calls[0];
  expect(payload).not.toHaveProperty('clientSecret');
});
```

**Test case C — new secret is sent (AC #3):**

```tsx
it('includes clientSecret in the update payload when provided', async () => {
  vi.mocked(ssoService.getSettings).mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    hasClientSecret: true,
    allowedDomains: [],
    enforceSso: false,
  });
  vi.mocked(ssoService.updateSettings).mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'abc',
    hasClientSecret: true,
    allowedDomains: [],
    enforceSso: false,
  });
  const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));

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

Note: mocking `ssoService.updateSettings` directly (rather than a global `fetch` mock) means Test cases B and C assert only on calls to that specific function — the GET call goes through the separately-mocked `ssoService.getSettings`, so there is no risk of the update assertion accidentally reading the GET call's arguments (the failure mode Copilot's review of #405 originally flagged against the pre-grounding raw-`fetch` sketch).

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
pnpm validate:i18n
```

Rollback: revert the new `sso-service.ts`, `use-sso-config.ts`, their test file, and the three locale-file `sso` section additions. Purely additive over already-existing, already-gated (#354) backend endpoints — nothing yet calls this data layer (that's #409's job), so reverting has zero effect on any existing behavior.
