/**
 * Dedup Rules admin page (PR-D2).
 *
 * Per-project list of dedup-rule engine rules with toggle / edit /
 * delete / create actions. Backend gates all routes behind
 * project-admin role + rejects API-key auth; this page mirrors that
 * by reusing `canManageIntegrations` as the client-side hide gate.
 * A dedicated `canManageDedupRules` flag can be added to the
 * permissions response when a 4th admin-tier surface lands.
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus } from 'lucide-react';
import { handleApiError } from '../lib/api-client';
import {
  dedupRulesService,
  type DedupRule,
  type DedupRuleRow,
} from '../services/dedup-rules-service';
import { useDedupRules, DEDUP_RULES_QUERY_KEY } from '../hooks/use-dedup-rules';
import { useProjectPermissions } from '../hooks/use-project-permissions';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { TooltipProvider } from '../components/ui/tooltip';
import { DedupRuleCard } from '../components/dedup-rules/rule-card';
import { DedupRuleFormDialog } from '../components/dedup-rules/rule-form-dialog';
import { DedupRuleDeleteDialog } from '../components/dedup-rules/delete-dialog';

export default function DedupRulesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { canManageIntegrations } = useProjectPermissions(projectId);

  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<DedupRuleRow | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const {
    data: rules = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [DEDUP_RULES_QUERY_KEY, projectId],
    queryFn: async () => dedupRulesService.list(projectId!),
    // Gate the request on permission too — the backend admin gate
    // would 403 a non-admin URL-typer, and surfacing that as an
    // "Error loading rules" toast is worse than just not making the
    // call. `canManageIntegrations` starts false until the
    // permissions query resolves, which naturally defers our fetch.
    enabled: !!projectId && canManageIntegrations,
  });

  function handleCloseFormDialog() {
    setShowFormDialog(false);
    setEditingRule(null);
  }

  // Destructure individual mutators — `useDedupRules` returns a fresh
  // object each render, so depending on the wrapper object would
  // recreate every callback on every render and defeat useCallback.
  const { create, update, toggleEnabled, deleteRule } = useDedupRules({
    projectId: projectId!,
    onSuccess: handleCloseFormDialog,
  });

  const handleOpenCreateDialog = useCallback(() => {
    setEditingRule(null);
    setShowFormDialog(true);
  }, []);

  const handleOpenEditDialog = useCallback((rule: DedupRuleRow) => {
    setEditingRule(rule);
    setShowFormDialog(true);
  }, []);

  const handleFormSubmit = useCallback(
    (payload: DedupRule, ruleId?: string) => {
      if (ruleId) {
        update.mutate({ ruleId, payload });
      } else {
        create.mutate(payload);
      }
    },
    [create, update]
  );

  const handleToggleEnabled = useCallback(
    (ruleId: string, currentEnabled: boolean) => {
      toggleEnabled.mutate({ ruleId, enabled: !currentEnabled });
    },
    [toggleEnabled]
  );

  const handleDelete = useCallback(() => {
    if (deletingRuleId) {
      // Keep the dialog open while the mutation is in flight so
      // `isDeleting` can drive a spinner; close on success only.
      // The hook surfaces failures via toast — the user stays on
      // the dialog and can retry or cancel.
      deleteRule.mutate(deletingRuleId, {
        onSuccess: () => setDeletingRuleId(null),
      });
    }
  }, [deletingRuleId, deleteRule]);

  const handleBackNavigation = useCallback(() => {
    navigate(`/projects/${projectId}`);
  }, [projectId, navigate]);

  if (!projectId) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-red-600">{t('dedupRules.missingProjectId')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-red-600">
          {t('dedupRules.errorLoading', { error: handleApiError(error) })}
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackNavigation}
                aria-label={t('dedupRules.backToProject')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-3xl font-bold">{t('dedupRules.title')}</h1>
            </div>
            <p className="text-gray-600">{t('dedupRules.subtitle')}</p>
          </div>
          <Button onClick={handleOpenCreateDialog} disabled={!canManageIntegrations}>
            <Plus className="h-4 w-4 mr-2" />
            {t('dedupRules.createRule')}
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-gray-500">{t('dedupRules.loading')}</p>
            </CardContent>
          </Card>
        ) : rules.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-gray-500">{t('dedupRules.empty')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <DedupRuleCard
                key={rule.id}
                rule={rule}
                readOnly={!canManageIntegrations}
                onToggleEnabled={handleToggleEnabled}
                onEdit={handleOpenEditDialog}
                onDelete={setDeletingRuleId}
              />
            ))}
          </div>
        )}

        <DedupRuleFormDialog
          open={showFormDialog}
          editingRule={editingRule}
          readOnly={!canManageIntegrations}
          onClose={handleCloseFormDialog}
          onSubmit={handleFormSubmit}
          isSubmitting={create.isPending || update.isPending}
        />

        <DedupRuleDeleteDialog
          open={!!deletingRuleId}
          onConfirm={handleDelete}
          onClose={() => setDeletingRuleId(null)}
          isDeleting={deleteRule.isPending}
        />
      </div>
    </TooltipProvider>
  );
}
