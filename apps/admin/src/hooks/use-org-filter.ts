import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * URL-backed cross-org filter, used by the platform-admin sidebar widget
 * and the four list pages (Projects, API Keys, Users, Bug Reports) it
 * scopes. Source of truth is the `organizationId` query param so that:
 *
 * - The filter survives reload / deep links.
 * - Two tabs can independently investigate two different orgs.
 * - Cross-page navigation preserves the filter as long as the link
 *   carries the query param along (React Router's `<Link>` doesn't by
 *   default — pages either use `?${searchParams}` in their links or
 *   read `useOrgFilter()` themselves and pass the param to their
 *   service calls).
 *
 * Non-platform-admin callers may still call this hook (it's harmless),
 * but the backend ignores `?organizationId=` for non-admins (verified
 * by the `bug-report-access.ts` security-boundary tests on PR #115).
 */
export function useOrgFilter(): {
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOrgId = searchParams.get('organizationId');

  const setSelectedOrgId = useCallback(
    (id: string | null) => {
      // Preserve every other query param when toggling org scope —
      // pagination, sort, status filters, etc. all live in the URL.
      const next = new URLSearchParams(searchParams);
      if (id) {
        next.set('organizationId', id);
      } else {
        next.delete('organizationId');
      }
      // `replace: true` so each dropdown change doesn't push a new
      // entry onto the browser history. Without this, the Back button
      // would walk through every filter selection instead of returning
      // to the previous page — a known footgun for filter widgets.
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  return { selectedOrgId, setSelectedOrgId };
}
