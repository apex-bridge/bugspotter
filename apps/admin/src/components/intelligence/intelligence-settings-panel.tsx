/**
 * Intelligence Settings Panel
 * Shared component used in both org member view and platform admin org detail.
 * Accepts orgId as a prop instead of relying on useOrganization context.
 */

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Brain, Key, AlertTriangle } from 'lucide-react';
import { intelligenceService } from '../../services/intelligence-service';
import { handleApiError } from '../../lib/api-client';
import { SettingsSection } from '../settings/settings-section';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { DeflectionStatsCard } from './deflection-stats-card';
import type {
  IntelligenceSettings,
  ProvisionKeyResult,
  UpdateIntelligenceSettingsInput,
} from '../../types/intelligence';

function applyKeyStatus(
  old: IntelligenceSettings | undefined,
  result: ProvisionKeyResult
): IntelligenceSettings | undefined {
  if (!old) {
    return old;
  }
  return {
    ...old,
    key_status: {
      provisioned: true,
      decryptable: true,
      provisioned_at: result.provisioned_at,
      provisioned_by: result.provisioned_by,
      key_hint: result.key_hint,
    },
  };
}

function clearKeyStatus(old: IntelligenceSettings | undefined): IntelligenceSettings | undefined {
  if (!old) {
    return old;
  }
  return {
    ...old,
    key_status: {
      provisioned: false,
      decryptable: false,
      provisioned_at: null,
      provisioned_by: null,
      key_hint: null,
    },
  };
}

type BooleanSettingsKey =
  | 'intelligence_enabled'
  | 'intelligence_auto_analyze'
  | 'intelligence_auto_enrich'
  | 'intelligence_dedup_enabled'
  | 'intelligence_self_service_enabled';

interface IntelligenceSettingsPanelProps {
  orgId: string;
  /** When true, hides the page title/description header */
  hideHeader?: boolean;
}

export function IntelligenceSettingsPanel({ orgId, hideHeader }: IntelligenceSettingsPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showProvisionForm, setShowProvisionForm] = useState(false);
  const [threshold, setThreshold] = useState('0.75');

  const queryKey = ['intelligence-settings', orgId];

  const {
    data: settings,
    isLoading,
    isError,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: () => intelligenceService.getSettings(orgId),
    enabled: !!orgId,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: UpdateIntelligenceSettingsInput) =>
      intelligenceService.updateSettings(orgId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(t('intelligence.settings.saved'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => intelligenceService.generateKey(orgId),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, (old: IntelligenceSettings | undefined) =>
        applyKeyStatus(old, result)
      );
      queryClient.invalidateQueries({ queryKey });
      toast.success(t('intelligence.settings.apiKeyProvisioned'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const provisionMutation = useMutation({
    mutationFn: () => intelligenceService.provisionKey(orgId, apiKeyInput),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, (old: IntelligenceSettings | undefined) =>
        applyKeyStatus(old, result)
      );
      queryClient.invalidateQueries({ queryKey });
      setApiKeyInput('');
      setShowProvisionForm(false);
      toast.success(t('intelligence.settings.apiKeyProvisioned'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => intelligenceService.revokeKey(orgId),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, (old: IntelligenceSettings | undefined) =>
        clearKeyStatus(old)
      );
      queryClient.invalidateQueries({ queryKey });
      toast.success(t('intelligence.settings.apiKeyNotProvisioned'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  useEffect(() => {
    if (settings?.intelligence_similarity_threshold != null) {
      setThreshold(String(settings.intelligence_similarity_threshold));
    }
  }, [settings?.intelligence_similarity_threshold]);

  const handleToggle = useCallback(
    (field: BooleanSettingsKey, value: boolean) => {
      updateMutation.mutate({ [field]: value });
    },
    [updateMutation]
  );

  const handleThresholdBlur = useCallback(
    (value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= 0 && num <= 1) {
        updateMutation.mutate({ intelligence_similarity_threshold: num });
      }
    },
    [updateMutation]
  );

  const handleDedupActionChange = useCallback(
    (value: string) => {
      if (value === 'flag' || value === 'auto_close') {
        updateMutation.mutate({ intelligence_dedup_action: value });
      }
    },
    [updateMutation]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 p-6 bg-red-50 border border-red-200 rounded-lg">
        <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
        <p className="text-sm text-red-700">{handleApiError(queryError)}</p>
      </div>
    );
  }

  if (!settings) {
    return null;
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div>
          <div className="flex items-center gap-3">
            <Brain className="h-6 w-6 text-gray-500" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900">{t('intelligence.settings.title')}</h1>
          </div>
          <p className="text-gray-500 mt-1">{t('intelligence.description')}</p>
        </div>
      )}

      {/* Core Settings */}
      <SettingsSection
        title={t('common.settings')}
        description={t('intelligence.settings.enabledDescription')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="intelligence-enabled"
              checked={settings.intelligence_enabled}
              onCheckedChange={(checked) => handleToggle('intelligence_enabled', checked === true)}
            />
            <Label htmlFor="intelligence-enabled">{t('intelligence.settings.enabled')}</Label>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="auto-analyze"
              checked={settings.intelligence_auto_analyze}
              onCheckedChange={(checked) =>
                handleToggle('intelligence_auto_analyze', checked === true)
              }
            />
            <div>
              <Label htmlFor="auto-analyze">{t('intelligence.settings.autoAnalyze')}</Label>
              <p className="text-sm text-gray-500">
                {t('intelligence.settings.autoAnalyzeDescription')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="auto-enrich"
              checked={settings.intelligence_auto_enrich}
              onCheckedChange={(checked) =>
                handleToggle('intelligence_auto_enrich', checked === true)
              }
            />
            <div>
              <Label htmlFor="auto-enrich">{t('intelligence.settings.autoEnrich')}</Label>
              <p className="text-sm text-gray-500">
                {t('intelligence.settings.autoEnrichDescription')}
              </p>
            </div>
          </div>

          <div className="max-w-xs">
            <Label htmlFor="similarity-threshold">
              {t('intelligence.settings.similarityThreshold')}
            </Label>
            <p className="text-sm text-gray-500 mb-1">
              {t('intelligence.settings.similarityThresholdDescription')}
            </p>
            <Input
              id="similarity-threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              onBlur={(e) => handleThresholdBlur(e.target.value)}
            />
          </div>
        </div>
      </SettingsSection>

      {/* API Key Management */}
      <SettingsSection
        title={t('intelligence.settings.apiKey')}
        description={t('intelligence.settings.apiKeyDescription')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-gray-400" aria-hidden="true" />
            {settings.key_status?.provisioned ? (
              <Badge variant="success">{t('intelligence.settings.apiKeyProvisioned')}</Badge>
            ) : (
              <Badge variant="secondary">{t('intelligence.settings.apiKeyNotProvisioned')}</Badge>
            )}
            {settings.key_status?.key_hint && (
              <span className="text-sm text-gray-500 font-mono">
                {settings.key_status?.key_hint}
              </span>
            )}
          </div>

          {settings.key_status?.provisioned_at && (
            <p className="text-sm text-gray-500">
              {t('intelligence.settings.apiKeyProvisionedAt', {
                date: new Date(settings.key_status?.provisioned_at).toLocaleDateString(),
              })}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {settings.key_status?.provisioned ? (
              <Button
                variant="destructive"
                size="sm"
                className="w-fit"
                onClick={() => {
                  if (window.confirm(t('intelligence.settings.revokeKeyConfirm'))) {
                    revokeMutation.mutate();
                  }
                }}
                disabled={revokeMutation.isPending}
              >
                {t('intelligence.settings.revokeKey')}
              </Button>
            ) : (
              <div className="space-y-3">
                {/* Primary: generate an isolated tenant key automatically */}
                <Button
                  size="sm"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending
                    ? t('common.loading')
                    : t('intelligence.settings.generateKey')}
                </Button>

                {/* Secondary: paste an existing key */}
                {showProvisionForm ? (
                  <div className="flex gap-2 items-end">
                    <div>
                      <Label htmlFor="api-key-input">{t('intelligence.settings.apiKey')}</Label>
                      <Input
                        id="api-key-input"
                        type="password"
                        placeholder={t('intelligence.settings.apiKeyPlaceholder')}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        className="w-64"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => provisionMutation.mutate()}
                      disabled={!apiKeyInput || provisionMutation.isPending}
                    >
                      {t('intelligence.settings.provisionKey')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowProvisionForm(false);
                        setApiKeyInput('');
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700"
                    onClick={() => setShowProvisionForm(true)}
                  >
                    {t('intelligence.settings.provisionKeyManually')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* Feature Flags */}
      <SettingsSection
        title={t('intelligence.featureFlags.title')}
        description={t('intelligence.featureFlags.dedupEnabledDescription')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="dedup-enabled"
              checked={settings.intelligence_dedup_enabled}
              onCheckedChange={(checked) =>
                handleToggle('intelligence_dedup_enabled', checked === true)
              }
            />
            <div>
              <Label htmlFor="dedup-enabled">{t('intelligence.featureFlags.dedupEnabled')}</Label>
              <p className="text-sm text-gray-500">
                {t('intelligence.featureFlags.dedupEnabledDescription')}
              </p>
            </div>
          </div>

          <div className="max-w-xs">
            <Label htmlFor="dedup-action">{t('intelligence.featureFlags.dedupAction')}</Label>
            <p className="text-sm text-gray-500 mb-1">
              {t('intelligence.featureFlags.dedupActionDescription')}
            </p>
            <select
              id="dedup-action"
              value={settings.intelligence_dedup_action}
              onChange={(e) => handleDedupActionChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="flag">{t('intelligence.featureFlags.dedupActionFlag')}</option>
              <option value="auto_close">
                {t('intelligence.featureFlags.dedupActionAutoClose')}
              </option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="self-service-enabled"
              checked={settings.intelligence_self_service_enabled}
              onCheckedChange={(checked) =>
                handleToggle('intelligence_self_service_enabled', checked === true)
              }
            />
            <div>
              <Label htmlFor="self-service-enabled">
                {t('intelligence.featureFlags.selfServiceEnabled')}
              </Label>
              <p className="text-sm text-gray-500">
                {t('intelligence.featureFlags.selfServiceEnabledDescription')}
              </p>
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Deflection Stats */}
      <DeflectionStatsCard orgId={orgId} />
    </div>
  );
}
