import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { intelligenceService } from '../services/intelligence-service';

/**
 * Read an org's `intelligence_enabled` flag.
 *
 * By default reads the viewer's `currentOrganization`. Pass `orgIdOverride`
 * to scope the check to a different org instead (e.g. a bug's own project
 * org, for platform-admin viewers with no personal org membership):
 *   - `undefined` (omitted) — no override; falls back to `currentOrganization?.id`.
 *   - `null` — an override is intended but not yet resolved; the query stays
 *     disabled and does NOT fall back to `currentOrganization`.
 *   - a string — used directly as the org id.
 *
 * Returns `null` while loading or when there is no resolvable org id so
 * callers can fail closed (don't render intel UI until we know).
 */
export function useIntelligenceStatus(orgIdOverride?: string | null): {
  isEnabled: boolean | null;
  isLoading: boolean;
} {
  const { currentOrganization } = useOrganization();
  const orgId =
    orgIdOverride === undefined ? currentOrganization?.id : (orgIdOverride ?? undefined);

  const { data, isLoading, isSuccess } = useQuery({
    queryKey: ['intelligence-status', orgId],
    queryFn: () => intelligenceService.getStatus(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  // `isSuccess` stays true across background refetches once we've
  // had data, so callers don't flicker back to `isEnabled: null`
  // while the cache revalidates.
  if (!isSuccess) {
    return { isEnabled: null, isLoading: !!orgId && isLoading };
  }
  return { isEnabled: data.intelligence_enabled, isLoading: false };
}
