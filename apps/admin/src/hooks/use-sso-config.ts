import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { ssoService } from '../services/sso-service';
import type { SsoConfig, SsoConfigUpdate } from '../types/sso';

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
    data: rawConfig,
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: ['sso-config', orgId],
    queryFn: () => ssoService.getSettings(orgId!),
    enabled: !!orgId,
  });

  // Defense in depth: strip a raw `clientSecret` even if the backend regresses
  // and returns one — the `SsoConfig` type alone is a compile-time contract,
  // not a runtime guarantee (ADR-0044 exists because a similar contract was
  // missed in review once already, see PR #345).
  const config = rawConfig ? stripClientSecret(rawConfig) : rawConfig;

  const updateMutation = useMutation({
    // `orgId` travels in the mutation variables, not just the outer closure,
    // so `onSuccess` invalidates the cache for the org the request actually
    // went to even if the viewer switches orgs while the request is in
    // flight (react-query re-binds callbacks to the latest render's
    // closures for an in-flight mutation, but `variables` stay fixed).
    mutationFn: ({ orgId: targetOrgId, payload }: { orgId: string; payload: SsoConfigUpdate }) =>
      ssoService.updateSettings(targetOrgId, payload),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['sso-config', variables.orgId] }),
  });

  return {
    config,
    isLoading,
    error: isError ? (error as Error) : null,
    updateConfig: (payload: SsoConfigUpdate) =>
      updateMutation.mutateAsync({ orgId: orgId!, payload }),
    isSaving: updateMutation.isPending,
  };
}

function stripClientSecret(config: SsoConfig): SsoConfig {
  const { clientSecret: _clientSecret, ...safeConfig } = config as SsoConfig & {
    clientSecret?: unknown;
  };
  return safeConfig;
}
