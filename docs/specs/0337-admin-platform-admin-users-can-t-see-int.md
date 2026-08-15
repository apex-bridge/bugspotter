# Spec: admin: platform-admin users can't see intelligence UI on bug detail view

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #337
ADR: n/a

**Files touched:**

- `apps/admin/src/hooks/use-intelligence-status.ts`
- `apps/admin/src/components/bug-reports/bug-report-detail.tsx`

**Blocking prerequisites:** none

## Problem

Platform-admin users — those with an elevated cross-org role but no personal organization membership row — see no intelligence-related UI on any bug's "Details & Metadata" tab. The AI Enrichment card, Similar Bugs widget, Duplicate match details section (added in #227/#336), and Suggest Fix button are all absent, even when the bug belongs to an organization with intelligence enabled. Critically, not even the "Intelligence disabled" fallback notice renders, so the user receives no signal that intelligence features exist for the organization. The root cause is that `useIntelligenceStatus` derives its `orgId` exclusively from `useOrganization().currentOrganization`, which is populated only from the logged-in user's personal membership list. Platform admins have no membership rows, so `currentOrganization` stays `null`, the hook's internal query never fires (`enabled: !!orgId`), and the hook permanently returns `{ isEnabled: null }` — the "still resolving" state that the detail component renders as nothing.

## Out of scope

- Changing `OrganizationContext`'s global auto-selection logic or the org-switcher UI used in the rest of the app.
- Backend authorization changes — `platformPolicy` in `packages/backend/src/api/authorization/policies/platform.policy.ts` already unconditionally allows platform admins on `GET /api/v1/organizations/:id/intelligence/status`.
- Any call site of `useIntelligenceStatus` outside `bug-report-detail.tsx`.
- Surfacing intelligence UI for bugs whose project has no resolvable `organization_id`.

## Constraints

1. The parameter change to `useIntelligenceStatus` must be backward-compatible — existing callers passing no argument must behave exactly as today, falling back to `currentOrganization?.id`.
2. The derived `orgId` passed from `bug-report-detail.tsx` must come from the bug's own project data, not from `OrganizationContext`, so it resolves independently of viewer membership.
3. No new backend routes, schema migrations, or changes to the intelligence service are required.
4. Normal org-member behavior must not regress: their cards must continue to gate off `currentOrganization` when no override is supplied.
5. `Project.organization_id` (in `apps/admin/src/types/`) is ASSUMED per the issue body — verify the field name and nullability before coding.
6. `BugReport.project_id` is ASSUMED per the issue body — verify the field name before coding.
7. The project record for the displayed bug is ASSUMED to already be fetched (or fetchable) within `bug-report-detail.tsx`; if it is not, add the minimal fetch needed without restructuring unrelated component logic.

## Acceptance criteria

- [ ] A platform-admin user with no personal org membership who opens a bug in an intelligence-enabled org sees the AI Enrichment card and Similar Bugs widget on the "Details & Metadata" tab — verified by test case A.
- [ ] A platform-admin user opening a bug in an intelligence-disabled org sees the "Intelligence disabled" notice rather than blank space — verified by test case B.
- [ ] `useIntelligenceStatus()` called with no argument continues to use `currentOrganization?.id` as before, returning `{ isEnabled: null }` when `currentOrganization` is `null` — verified by test case D.
- [ ] A normal org-member user sees no regression: intelligence cards still gate correctly off `currentOrganization` — verified by test case C.
- [ ] When `project.organization_id` is available it takes precedence over `currentOrganization?.id` — verified by test case A.

## Changes

### `apps/admin/src/hooks/use-intelligence-status.ts`

Add an optional `orgIdOverride` parameter; use it in place of `currentOrganization?.id` when present. All other hook logic (query key, `enabled` guard, return shape) remains unchanged.

```ts
// Replace the existing function signature and orgId derivation.
// Assumed current shape (verify in file before editing):
//   export function useIntelligenceStatus() {
//     const { currentOrganization } = useOrganization();
//     const orgId = currentOrganization?.id;

// New signature and derivation — insert these two lines in place of the above:
export function useIntelligenceStatus(orgIdOverride?: string) {
  const { currentOrganization } = useOrganization();
  const orgId = orgIdOverride ?? currentOrganization?.id;
  // remainder of hook body unchanged
```

### `apps/admin/src/components/bug-reports/bug-report-detail.tsx`

Derive `bugOrgId` from the project record already associated with the bug report (ASSUMED: project data is fetched in this component — verify existing variable name). Pass it as the override to `useIntelligenceStatus`.

```ts
// Append after the line where `project` is resolved (ASSUMED variable name — verify):
const bugOrgId: string | undefined = project?.organization_id ?? undefined;

// Replace the existing call (ASSUMED current call — verify in file):
//   const { isEnabled } = useIntelligenceStatus();
// With:
const { isEnabled } = useIntelligenceStatus(bugOrgId);
```

## Tests

### `apps/admin/src/tests/use-intelligence-status.test.ts`

**Mock/fixture updates required:**

`useOrganization` must be mockable at the module level. The hook's internal HTTP fetch (ASSUMED to target `/api/v1/organizations/:id/intelligence/status` — unverified: `apps/admin/src/services/intelligence-service` was not available to check the exact URL) must be interceptable — use the project's existing MSW setup if present, otherwise mock the fetcher module directly. Confirm the actual import path for `useOrganization` (confirmed from source: `../contexts/organization-context`) before finalising.

```ts
// At top level (vi.mock must be hoisted):
vi.mock('../contexts/organization-context', () => ({
  useOrganization: vi.fn(),
}));
```

**Test case A — platform admin, intelligence-enabled org, override provided (AC #1, #5):**

```ts
it('uses orgIdOverride and returns isEnabled true when override resolves an enabled org', async () => {
  vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);
  server.use(
    http.get('/api/v1/organizations/org-enabled/intelligence/status', () =>
      HttpResponse.json({ intelligence_enabled: true })
    )
  );

  const { result } = renderHook(() => useIntelligenceStatus('org-enabled'), {
    wrapper: queryClientWrapper,
  });

  await waitFor(() => expect(result.current.isEnabled).toBe(true));
});
```

**Test case B — platform admin, intelligence-disabled org, override provided (AC #2):**

```ts
it('returns isEnabled false when override resolves a disabled org', async () => {
  vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);
  server.use(
    http.get('/api/v1/organizations/org-disabled/intelligence/status', () =>
      HttpResponse.json({ intelligence_enabled: false })
    )
  );

  const { result } = renderHook(() => useIntelligenceStatus('org-disabled'), {
    wrapper: queryClientWrapper,
  });

  await waitFor(() => expect(result.current.isEnabled).toBe(false));
});
```

**Test case C — normal org member, no override, currentOrganization present (AC #4):**

```ts
it('falls back to currentOrganization.id when no override is provided', async () => {
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: 'org-member' },
  } as any);
  server.use(
    http.get('/api/v1/organizations/org-member/intelligence/status', () =>
      HttpResponse.json({ intelligence_enabled: true })
    )
  );

  const { result } = renderHook(() => useIntelligenceStatus(), {
    wrapper: queryClientWrapper,
  });

  await waitFor(() => expect(result.current.isEnabled).toBe(true));
});
```

**Test case D — no override, no currentOrganization, query never fires (AC #3):**

```ts
it('returns isEnabled null and does not fire a query when no override and no currentOrganization', () => {
  vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);

  const { result } = renderHook(() => useIntelligenceStatus(), {
    wrapper: queryClientWrapper,
  });

  expect(result.current.isEnabled).toBeNull();
});
```

## Verification

```bash
pnpm --filter @bugspotter/admin typecheck
pnpm --filter @bugspotter/admin test
```

Rollback: all changes are additive — an optional parameter on one hook and a two-line derivation at one call site. Reverting the PR fully restores current behavior. No DB changes, no migrations, no irreversible steps.
