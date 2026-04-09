/**
 * Integration Rules Hook - Manages CRUD operations
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { integrationRulesService } from '../services/integration-rules-service';
import { handleApiError } from '../lib/api-client';
import type { CreateIntegrationRuleRequest, UpdateIntegrationRuleRequest } from '../types';

export const RULES_QUERY_KEY = 'integrationRules';

export interface UseIntegrationRulesProps {
  platform: string;
  projectId: string;
  onSuccess?: () => void;
}

export function useIntegrationRules({ platform, projectId, onSuccess }: UseIntegrationRulesProps) {
  const queryClient = useQueryClient();

  const invalidateRules = () => {
    queryClient.invalidateQueries({ queryKey: [RULES_QUERY_KEY, platform, projectId] });
  };

  const create = useMutation({
    mutationFn: (payload: CreateIntegrationRuleRequest) =>
      integrationRulesService.create(platform, projectId, payload),
    onSuccess: () => {
      invalidateRules();
      toast.success('Rule created successfully');
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const update = useMutation({
    mutationFn: ({ ruleId, payload }: { ruleId: string; payload: UpdateIntegrationRuleRequest }) =>
      integrationRulesService.update(platform, projectId, ruleId, payload),
    onSuccess: () => {
      invalidateRules();
      toast.success('Rule updated successfully');
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      integrationRulesService.toggleEnabled(platform, projectId, ruleId, enabled),
    onSuccess: () => {
      invalidateRules();
      toast.success('Rule status updated');
    },
    onError: (error) => toast.error(handleApiError(error)),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => integrationRulesService.delete(platform, projectId, ruleId),
    onSuccess: () => {
      invalidateRules();
      toast.success('Rule deleted successfully');
    },
    onError: (error) => toast.error(handleApiError(error)),
  });

  const copy = useMutation({
    mutationFn: ({ ruleId, targetProjectId }: { ruleId: string; targetProjectId: string }) =>
      integrationRulesService.copy(platform, projectId, ruleId, { targetProjectId }),
    onSuccess: (data, variables) => {
      invalidateRules();
      // Invalidate target project's query cache
      queryClient.invalidateQueries({
        queryKey: [RULES_QUERY_KEY, platform, variables.targetProjectId],
      });
      toast.success(data.message || 'Rule copied successfully');
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  return {
    create,
    update,
    toggleEnabled,
    deleteRule,
    copy,
  };
}
