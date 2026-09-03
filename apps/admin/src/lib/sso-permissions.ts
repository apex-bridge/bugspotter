/**
 * Who may view and change an organization's SSO configuration.
 *
 * Shared by the page itself (`pages/organization/org-sso.tsx`) and the sidebar
 * entry that points at it (`components/dashboard-layout.tsx`). Keeping one rule
 * here is what stops the two from drifting into a link that appears for someone
 * the page then refuses to render for.
 *
 * Takes the two values `usePermissions()` already returns rather than calling
 * the hook itself, so it stays usable from a nav array and from tests.
 */
export function canManageSso(isSystemAdmin: boolean, orgRole: string | null): boolean {
  return isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';
}
