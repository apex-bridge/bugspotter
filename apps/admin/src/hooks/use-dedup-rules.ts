/**
 * Dedup-rules hook — TanStack mutations for the CRUD service.
 *
 * Mirrors `use-integration-rules.ts`. The query key is
 * `[DEDUP_RULES_QUERY_KEY, projectId]`; mutations invalidate it on
 * success. Errors are surfaced via `handleApiError` + `toast.error`
 * (English-only to match the precedent; backend error messages are
 * also English).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { handleApiError } from '../lib/api-client';
import { dedupRulesService, type DedupRule } from '../services/dedup-rules-service';

export const DEDUP_RULES_QUERY_KEY = 'dedupRules';

export interface UseDedupRulesProps {
  projectId: string;
  /** Fires after a successful create/update, e.g. to close a dialog. */
  onSuccess?: () => void;
}

export function useDedupRules({ projectId, onSuccess }: UseDedupRulesProps) {
  const queryClient = useQueryClient();

  const invalidateRules = () => {
    queryClient.invalidateQueries({ queryKey: [DEDUP_RULES_QUERY_KEY, projectId] });
  };

  const create = useMutation({
    mutationFn: (payload: DedupRule) => dedupRulesService.create(projectId, payload),
    onSuccess: () => {
      invalidateRules();
      toast.success('Dedup rule created');
      onSuccess?.();
    },
    onError: (error) => toast.error(handleApiError(error)),
  });

  const update = useMutation({
    mutationFn: ({ ruleId, payload }: { ruleId: string; payload: DedupRule }) =>
      dedupRulesService.update(projectId, ruleId, payload),
    onSuccess: () => {
      invalidateRules();
      toast.success('Dedup rule updated');
      onSuccess?.();
    },
    onError: (error) => toast.error(handleApiError(error)),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      dedupRulesService.toggleEnabled(projectId, ruleId, enabled),
    onSuccess: () => {
      invalidateRules();
      // No toast on toggle — the row's visual state flips instantly
      // and rapid on/off clicks would stack noisy "status updated"
      // toasts. The error path still surfaces a toast.
    },
    onError: (error) => toast.error(handleApiError(error)),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => dedupRulesService.delete(projectId, ruleId),
    onSuccess: () => {
      invalidateRules();
      toast.success('Dedup rule deleted');
    },
    onError: (error) => toast.error(handleApiError(error)),
  });

  return { create, update, toggleEnabled, deleteRule };
}
