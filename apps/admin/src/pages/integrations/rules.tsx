import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus } from 'lucide-react';
import { projectService } from '../../services/api';
import { handleApiError } from '../../lib/api-client';
import { exportRuleAsJson, copyRuleAsJson } from '../../lib/export-utils';
import { integrationRulesService } from '../../services/integration-rules-service';
import { useIntegrationRules, RULES_QUERY_KEY } from '../../hooks/use-integration-rules';
import { useProjectPermissions } from '../../hooks/use-project-permissions';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { toast } from 'sonner';
import { RuleCard } from '../../components/integrations/rule-card';
import { RuleFormDialog } from '../../components/integrations/rule-form-dialog';
import { CopyRuleDialog } from '../../components/integrations/copy-rule-dialog';
import { DeleteRuleDialog } from '../../components/integrations/delete-rule-dialog';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { IntegrationRule, CreateIntegrationRuleRequest } from '../../types';

export default function IntegrationRulesPage() {
  const { platform, projectId } = useParams<{ platform: string; projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { canManageIntegrations } = useProjectPermissions(projectId);

  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<IntegrationRule | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [copyingRule, setCopyingRule] = useState<IntegrationRule | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<string>('');

  // Fetch rules
  const {
    data: rules = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [RULES_QUERY_KEY, platform, projectId],
    queryFn: async () => integrationRulesService.list(platform!, projectId!),
    enabled: !!platform && !!projectId,
  });

  // Fetch all projects for copy dialog
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  // Memoize filtered projects list
  const targetProjects = useMemo(
    () => projects.filter((p) => p.id !== projectId),
    [projects, projectId]
  );

  // Mutations hook
  const mutations = useIntegrationRules({
    platform: platform!,
    projectId: projectId!,
    onSuccess: handleCloseFormDialog,
  });

  // Dialog handlers
  function handleCloseFormDialog() {
    setShowFormDialog(false);
    setEditingRule(null);
  }

  const handleOpenCreateDialog = useCallback(() => {
    setEditingRule(null);
    setShowFormDialog(true);
  }, []);

  const handleOpenEditDialog = useCallback((rule: IntegrationRule) => {
    setEditingRule(rule);
    setShowFormDialog(true);
  }, []);

  const handleFormSubmit = useCallback(
    (payload: CreateIntegrationRuleRequest, ruleId?: string) => {
      if (ruleId) {
        mutations.update.mutate({ ruleId, payload });
      } else {
        mutations.create.mutate(payload);
      }
    },
    [mutations]
  );

  const handleToggleEnabled = useCallback(
    (ruleId: string, currentEnabled: boolean) => {
      mutations.toggleEnabled.mutate({ ruleId, enabled: !currentEnabled });
    },
    [mutations]
  );

  const handleDelete = useCallback(() => {
    if (deletingRuleId) {
      mutations.deleteRule.mutate(deletingRuleId);
      setDeletingRuleId(null);
    }
  }, [deletingRuleId, mutations]);

  const handleCopyRule = useCallback(() => {
    if (copyingRule && targetProjectId) {
      mutations.copy.mutate(
        { ruleId: copyingRule.id, targetProjectId },
        {
          onSuccess: () => {
            setCopyingRule(null);
            setTargetProjectId('');
          },
        }
      );
    }
  }, [copyingRule, targetProjectId, mutations]);

  const handleExportJson = useCallback((rule: IntegrationRule) => {
    exportRuleAsJson(rule);
  }, []);

  const handleCopyJson = useCallback(
    async (rule: IntegrationRule) => {
      try {
        await copyRuleAsJson(rule);
        toast.success(t('integrationRules.ruleJsonCopied', { name: rule.name }));
      } catch {
        toast.error(t('integrationRules.failedToCopyJson'));
      }
    },
    [t]
  );

  const handleBackNavigation = useCallback(() => {
    navigate(`/projects/${projectId}/integrations`);
  }, [projectId, navigate]);

  if (!platform || !projectId) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-red-600">{t('integrationRules.missingPlatformOrProjectId')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-red-600">
          {t('integrationRules.errorLoadingRules', { error: handleApiError(error) })}
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackNavigation}
                aria-label={t('integrationRules.backToIntegration')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-3xl font-bold">{t('integrationRules.title')}</h1>
            </div>
            <p className="text-gray-600">
              {t('integrationRules.configureFiltering', { platform })}
            </p>
          </div>
          <Button onClick={handleOpenCreateDialog} disabled={!canManageIntegrations}>
            <Plus className="h-4 w-4 mr-2" />
            {t('integrationRules.createRule')}
          </Button>
        </div>

        {/* Rules list */}
        {isLoading ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-gray-500">{t('integrationRules.loadingRules')}</p>
            </CardContent>
          </Card>
        ) : rules.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-gray-500">{t('integrationRules.noRulesConfigured')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                readOnly={!canManageIntegrations}
                onToggleEnabled={handleToggleEnabled}
                onEdit={handleOpenEditDialog}
                onDelete={setDeletingRuleId}
                onCopy={setCopyingRule}
                onExportJson={handleExportJson}
                onCopyJson={handleCopyJson}
              />
            ))}
          </div>
        )}

        {/* Dialogs */}
        <RuleFormDialog
          open={showFormDialog}
          platform={platform}
          projectId={projectId!}
          editingRule={editingRule}
          readOnly={!canManageIntegrations}
          onClose={handleCloseFormDialog}
          onSubmit={handleFormSubmit}
          isSubmitting={mutations.create.isPending || mutations.update.isPending}
        />

        <DeleteRuleDialog
          open={!!deletingRuleId}
          onConfirm={handleDelete}
          onClose={() => setDeletingRuleId(null)}
          isDeleting={mutations.deleteRule.isPending}
        />

        <CopyRuleDialog
          open={!!copyingRule}
          rule={copyingRule}
          targetProjects={targetProjects}
          targetProjectId={targetProjectId}
          onTargetProjectChange={setTargetProjectId}
          onCopy={handleCopyRule}
          onClose={() => {
            setCopyingRule(null);
            setTargetProjectId('');
          }}
          isSubmitting={mutations.copy.isPending}
        />
      </div>
    </TooltipProvider>
  );
}
