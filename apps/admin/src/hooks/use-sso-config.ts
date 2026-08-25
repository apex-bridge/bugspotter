import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { ssoService } from '../services/sso-service';
import type { SsoConfigUpdate } from '../types/sso';

/**
 * Read and update the current org's SSO (OIDC) configuration.
 *
 * Modeled on the intelligence settings hooks' org-scoped query shape.
 * `config` never carries a raw `clientSecret` — the service's GET
 * response type (`SsoConfig`) has no such field; only the boolean
 * `hasClientSecret` signals whether one is currently set (ADR-0044,
 * PR #345). `updateConfig`'s payload type (`SsoConfigUpdate`) makes
 * `clientSecret` optional rather than a nullable string, so callers
 * omit the key to keep the existing secret instead of accidentally
 * sending `''` and clearing it.
 */
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
