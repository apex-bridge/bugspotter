import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import integrationService from '../services/integration-service';
import { handleApiError, getApiErrorStatus } from '../lib/api-client';
import { isValidIntegration, type IntegrationResponse } from '../types/integration';
import { isJiraConfig, validateJiraConfig } from '../utils/type-guards';
import { defaultLinearConfig, isLinearConfig, validateLinearConfig } from '../integrations/linear';

interface UseIntegrationConfigOptions {
  type: string;
  onSaveSuccess?: () => void;
}

export type TestConnectionResult = { ok: true } | { ok: false; error: string; statusCode?: number };

interface UseIntegrationConfigReturn<T> {
  integration: IntegrationResponse | undefined;
  config: T | undefined;
  localConfig: T;
  setLocalConfig: React.Dispatch<React.SetStateAction<T>>;
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  save: () => Promise<void>;
  /**
   * Returns a structured result so callers can render inline state
   * (success badge / friendly error box) instead of relying solely on
   * the toast. Toast is still emitted by default for backwards compat
   * with non-Jira integrations and for users who navigate away from
   * the step before the response arrives. Pass `{ silent: true }` to
   * suppress toasts when the caller renders its own inline feedback.
   */
  testConnection: (
    baseType: string,
    options?: { silent?: boolean }
  ) => Promise<TestConnectionResult>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isSaving: boolean;
}

/**
 * Shared hook for integration configuration management
 * Handles fetching, updating, and testing integration configs
 *
 * IMPORTANT: Config field consolidation complete (2025-12-16)
 * - All integration types now use the 'config' field
 * - Backend auto-sets status to 'active' when config is provided
 * - Updates are sent as { config: {...} } to backend
 *
 * Type parameter T should be Record<string, unknown> for broad compatibility
 * Built-in Jira integrations can cast to JiraConfig when needed
 */
/**
 * Strip the per-instance suffix from a multi-instance integration `type`
 * to get the platform identifier the platform-configurator dispatch
 * needs (e.g. `jira_e2e_12345` → `jira`). Repeated in two callbacks
 * inside the hook, so derive once at the top.
 */
function getBaseType(type: string): string {
  return type.includes('_') ? type.split('_')[0] : type;
}

export function useIntegrationConfig<T = Record<string, unknown>>({
  type,
  onSaveSuccess,
}: UseIntegrationConfigOptions): UseIntegrationConfigReturn<T> {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [localConfig, setLocalConfig] = useState<T>({} as T);
  const [description, setDescription] = useState<string>('');
  const baseType = getBaseType(type);

  // Fetch integration config
  const {
    data: rawIntegration,
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: ['integration', type],
    queryFn: async () => {
      return await integrationService.getConfig(type);
    },
  });

  // Extract and validate integration data
  const integration = isValidIntegration(rawIntegration) ? rawIntegration : undefined;
  // Use config field (consolidation complete)
  const config = integration?.config as T | undefined;

  // Sync fetched config and description to local state
  useEffect(() => {
    if (config && Object.keys(config).length > 0) {
      setLocalConfig(config);
    } else if (integration && !integration.is_custom) {
      // TODO(platform-configurator): When a 3rd plugin lands or admin UI
      // touches this dispatch again, replace this branch with a registry
      // lookup `getConfigurator(baseType).defaultConfig`. See auto-memory
      // note `project_admin_ui_platform_configurator` and the parallel
      // anchors in pages/integrations/integration-config.tsx and
      // pages/project-integration-config.tsx.
      if (baseType === 'linear') {
        // Spread to avoid sharing the const reference — a downstream
        // in-place mutation (none today, but cheap insurance) could
        // otherwise pollute the shared module-level default.
        setLocalConfig({ ...defaultLinearConfig } as unknown as T);
      } else {
        // Default Jira config structure for any other built-in integration.
        setLocalConfig({
          instanceUrl: '',
          projectKey: '',
          authentication: {
            type: 'basic',
            email: '',
            apiToken: '',
          },
        } as T);
      }
    }
    if (integration?.description) {
      setDescription(integration.description);
    }
  }, [config, integration?.description, integration?.is_custom, baseType]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ t, payload, desc }: { t: string; payload: T; desc?: string }) =>
      // Wrap config in config field for proper storage, send description at root level
      integrationService.updateConfig(t, {
        config: payload as Record<string, unknown>,
        description: desc,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['integration', type] });
      // Note: NOT invalidating `['integrations-summary']` — that key
      // counts rows in `project_integrations` (per-project instances),
      // and this hook mutates `integrations.config` (platform-level
      // config, no row created/destroyed). The invalidation belongs
      // on the per-project save/delete sites in project-integration-config.tsx.
      onSaveSuccess?.();
    },
  });

  // Helper to update a single field
  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setLocalConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Validation helper
  const validateConfig = useCallback((): string | null => {
    // Skip validation for custom plugins - they have dynamic field requirements
    if (integration?.is_custom === true) {
      return null;
    }

    // TODO(platform-configurator): When a 3rd plugin lands or admin UI
    // touches this dispatch again, replace this branch with a registry
    // lookup `getConfigurator(baseType).validate(localConfig)`. See
    // auto-memory note `project_admin_ui_platform_configurator`.
    if (baseType === 'linear') {
      if (!isLinearConfig(localConfig)) {
        return 'Invalid Linear configuration structure.';
      }
      return validateLinearConfig(localConfig);
    }

    // For built-in Jira integrations, validate structure first with type guard
    if (!isJiraConfig(localConfig)) {
      return 'Invalid configuration structure. Please ensure all required fields are present.';
    }

    // Now we can safely access JiraConfig properties and perform strict validation
    const jiraConfig = localConfig;
    return validateJiraConfig(jiraConfig);
  }, [localConfig, integration, baseType]);

  // Save configuration and description
  const save = useCallback(async () => {
    if (!type) {
      toast.error('Please fill in required fields before saving.');
      return;
    }

    const validationError = validateConfig();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      // Send config and description separately (description at root level, not in config)
      await updateMutation.mutateAsync({ t: type, payload: localConfig, desc: description });
      toast.success('Configuration saved successfully.');
    } catch (error: unknown) {
      const errorMessage = handleApiError(error);
      toast.error(`Failed to save configuration: ${errorMessage}`);
    }
  }, [type, description, localConfig, validateConfig, updateMutation]);

  // Test connection
  const testConnection = useCallback(
    async (baseType: string, options?: { silent?: boolean }): Promise<TestConnectionResult> => {
      const silent = options?.silent === true;
      const validationError = validateConfig();
      if (validationError) {
        if (!silent) {
          toast.error(validationError);
        }
        return { ok: false, error: validationError };
      }

      try {
        await integrationService.testConnection(baseType, localConfig as Record<string, unknown>);
        if (!silent) {
          toast.success(t('integrationConfig.testSuccess'));
        }
        return { ok: true };
      } catch (error: unknown) {
        const errorMessage = handleApiError(error);
        // Pull HTTP status off axios errors so callers can map
        // 401/403/404 to friendly hints without re-parsing.
        const statusCode = getApiErrorStatus(error);
        if (!silent) {
          toast.error(t('integrationConfig.testFailedToast', { error: errorMessage }));
        }
        return { ok: false, error: errorMessage, statusCode };
      }
    },
    [localConfig, validateConfig, t]
  );

  return {
    integration,
    config,
    localConfig,
    setLocalConfig,
    description,
    setDescription,
    updateField,
    save,
    testConnection,
    isLoading,
    isError,
    error: isError ? (error as Error) : null,
    isSaving: updateMutation.isPending,
  };
}
