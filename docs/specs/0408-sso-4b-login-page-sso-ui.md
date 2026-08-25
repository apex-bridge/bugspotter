# Spec: SSO 4b/4 Login page SSO UI

Linked issue: Refs #408
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `apps/admin/src/pages/login.tsx` (changed)
- `apps/admin/src/tests/pages/login.test.tsx` (new)

**Blocking prerequisites:** #406 (Slice 1 — `authService.getSsoStatus()`) must land and be implemented first; this slice calls that method directly.

**Split note:** this is Slice 2 of #355 (Refs #355), split from that issue's combined spec (PR #405, `docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md`) after it was blocked by `check-spec-scope.mjs`'s hard 6-file gate (13 files declared, once every wildcard in the original 7-file draft was grounded against the real admin-app tree, against a 6-file cap). Hand-extracted directly from #405's own already-grounded spec content — not regenerated from scratch, to avoid reintroducing grounding errors already fixed there, same reasoning #367/#368 and #394/#395 used for their splits. Depends on Slice 1 (#406) landing and being implemented first; independent of Slices 3/4 (#407/#409, the config-page half of this feature).

## Problem

The login form has no way to route a user into an SSO flow, or to suppress password fields for a tenant that has made SSO mandatory (`enforce_sso: true`). End users at an SSO-enforced tenant have no usable UI path today.

## Out of scope

- The `authService.getSsoStatus()` method itself — that is #406 (this slice only calls it).
- The SSO config page, its data layer, and its route — that is #407/#409.
- The actual OIDC redirect/callback flow initiated by clicking "Sign in with SSO" — this spec covers only the button's presence/visibility, not the auth handshake it triggers.
- Backend endpoint implementation and gating (#353, #354 — #354 already merged).
- Any change to `bugspotter-sdk`, `bugspotter-extension`, or `bugspotter-landing`.

## Constraints

1. The login form must resolve the current tenant's `enforce_sso` value before deciding whether to render password fields, to avoid a flash of password UI that's immediately replaced (avoid layout shift and avoid briefly offering a login method the tenant has disabled). Because this runs on an unauthenticated page, it fetches via `authService.getSsoStatus()` (#406) — an unauthenticated, host/subdomain-resolved call, mirroring how `authService.getRegistrationStatus()` already works today (same pre-auth, tenant-resolved-by-host shape, called from the same `useEffect` in `login.tsx`).
2. `handleSsoLogin` (the actual redirect/callback trigger) is explicitly out of scope — the button's presence and the password-field visibility are what's tested here, not the handshake.
3. On a failed `getSsoStatus()` call, fail open to password fields — matches the existing `getRegistrationStatus()` error handling already in `login.tsx`, which also fails to a safe default rather than blocking the page.
4. `apps/admin/src/pages/login.tsx` is the actual, only login form in this codebase (already imported directly by `App.tsx`: `<Route path="/login" element={<LoginPage />} />`, no wrapper component) — there is no separate `components/auth/*` login-form component to change instead.

## Acceptance criteria

- [ ] The login form always renders a "Sign in with SSO" button regardless of `enforce_sso` — verified by Test case D
- [ ] When the resolved tenant has `enforce_sso: true`, the login form does not render password/credential fields — verified by Test case E
- [ ] When `enforce_sso` is `false` or absent, the login form renders password fields alongside the SSO button — verified by Test case F

## Changes

### `apps/admin/src/pages/login.tsx` (changed)

This is the actual, only login form, already imported directly by `App.tsx`. Fetch SSO status in the same post-`isInitialized` `useEffect` that already calls `authService.getRegistrationStatus()`, add local state, and gate the password fields on it. The state is tri-state (`boolean | null`, starting `null`) rather than a plain boolean defaulting to `false`, specifically so password fields never render before the status is known — a plain `useState(false)` would render them on first paint and then hide them once `getSsoStatus()` resolves, which is the flash/layout-shift Constraint #1 rules out.

```tsx
// New state, alongside the existing registrationAllowed/passwordResetEnabled.
// `null` = not yet resolved. Password fields stay hidden until this is
// `false`, so there's no flash of password UI on first paint.
const [enforceSso, setEnforceSso] = useState<boolean | null>(null);

// Inside the existing useEffect (after isInitialized), alongside the
// existing authService.getRegistrationStatus() call:
authService.getSsoStatus().then(
  (status) => setEnforceSso(status.enforceSso),
  () => {
    // Fail open to password fields on a status-check failure — matches
    // the existing getRegistrationStatus() error handling above, which
    // also fails to a safe default rather than blocking the page.
    setEnforceSso(false);
  }
);

// In the JSX, wrap the existing email/password <Input> pair. Gating on
// `=== false` (not `!enforceSso`) keeps password fields hidden both while
// the status is unresolved (null) and once it resolves true:
{
  enforceSso === false && (
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

`handleSsoLogin` (the actual redirect/callback trigger) is explicitly out of scope per this spec's "Out of scope" section — the button's presence and the password-field visibility are what's tested here, not the handshake.

## Tests

### `apps/admin/src/tests/pages/login.test.tsx` (new)

No test file for `login.tsx` currently exists anywhere in the repo (checked `tests/pages/`, `tests/components/` — neither has one; the original spec's `login-form.test.tsx` assumed an existing file to change, which is wrong on two counts: wrong path and wrong new/changed status). This is a first-ever test for the page, so it needs the same mock surface `login.tsx` itself depends on: `useAuth`, `useSetupGuard`, `useInvitationPreview`, `authService` (both `getRegistrationStatus` and the new `getSsoStatus`), `sonner`'s `toast`, and `react-router-dom`'s `useNavigate`/`useSearchParams`.

Follow the existing pattern from `tests/pages/register.test.tsx`: plain Vitest assertions only (no `@testing-library/jest-dom` matchers like `toBeInTheDocument()` — they have a known setup issue in this project, per that file's header comment), and a `renderLoginPage()` helper that wraps in `<BrowserRouter>` since `login.tsx` renders a `<Link>`:

```tsx
function renderLoginPage() {
  return render(
    <BrowserRouter>
      <LoginPage />
    </BrowserRouter>
  );
}
```

**Test case D — SSO button always present (AC #1):**

```tsx
it('always renders the Sign in with SSO button', () => {
  vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: false });
  renderLoginPage();
  expect(screen.getByRole('button', { name: /sign in with sso/i })).toBeDefined();
});
```

**Test case E — password fields hidden when enforced (AC #2):**

```tsx
it('hides password fields when the tenant enforces SSO', async () => {
  vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: true });
  renderLoginPage();
  await waitFor(() => expect(screen.queryByLabelText(/password/i)).toBeNull());
});
```

**Test case F — password fields shown when not enforced (AC #3):**

```tsx
it('shows password fields when SSO is not enforced', async () => {
  vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: false });
  renderLoginPage();
  await waitFor(() => expect(screen.getByLabelText(/^password/i)).toBeDefined());
});
```

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
```

Rollback: revert the `useEffect` call, local state, and button addition in `login.tsx`, and remove the new test file. Purely additive — the actual SSO redirect/callback handler is out of scope for this slice, so reverting has zero effect on any existing login behavior.
