import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import integrationService from '../services/integration-service';
import { handleApiError } from '../lib/api-client';
import { isValidIntegration, type IntegrationResponse } from '../types/integration';
import { isJiraConfig, validateJiraConfig } from '../utils/type-guards';

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
   * the toast. Toast is still emitted for backwards compat with
   * non-Jira integrations and for users who navigate away from the
   * step before the response arrives.
   */
  testConnection: (baseType: string) => Promise<TestConnectionResult>;
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
export function useIntegrationConfig<T = Record<string, unknown>>({
  type,
  onSaveSuccess,
}: UseIntegrationConfigOptions): UseIntegrationConfigReturn<T> {
  const queryClient = useQueryClient();
  const [localConfig, setLocalConfig] = useState<T>({} as T);
  const [description, setDescription] = useState<string>('');

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
      // For built-in integrations with no config yet, set default Jira config structure
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
    if (integration?.description) {
      setDescription(integration.description);
    }
  }, [config, integration?.description, integration?.is_custom]);

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

    // For built-in Jira integrations, validate structure first with type guard
    if (!isJiraConfig(localConfig)) {
      return 'Invalid configuration structure. Please ensure all required fields are present.';
    }

    // Now we can safely access JiraConfig properties and perform strict validation
    const jiraConfig = localConfig;
    return validateJiraConfig(jiraConfig);
  }, [localConfig, integration]);

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
    async (baseType: string): Promise<TestConnectionResult> => {
      const validationError = validateConfig();
      if (validationError) {
        toast.error(validationError);
        return { ok: false, error: validationError };
      }

      try {
        await integrationService.testConnection(baseType, localConfig as Record<string, unknown>);
        toast.success('Connection test passed! Configuration is valid.');
        return { ok: true };
      } catch (error: unknown) {
        const errorMessage = handleApiError(error);
        // Pull HTTP status off axios errors when present so callers
        // can map 401/403/404 to friendly hints without re-parsing.
        let statusCode: number | undefined;
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { status?: number } }).response?.status !== undefined
        ) {
          statusCode = (error as { response: { status: number } }).response.status;
        }
        toast.error(`Connection test failed: ${errorMessage}`);
        return { ok: false, error: errorMessage, statusCode };
      }
    },
    [localConfig, validateConfig]
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
