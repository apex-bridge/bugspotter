import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { intelligenceService } from '../services/intelligence-service';

/**
 * Read the current org's `intelligence_enabled` flag.
 * Returns `null` while loading or when there is no current org so
 * callers can fail closed (don't render intel UI until we know).
 */
export function useIntelligenceStatus(): {
  isEnabled: boolean | null;
  isLoading: boolean;
} {
  const { currentOrganization } = useOrganization();
  const orgId = currentOrganization?.id;

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
