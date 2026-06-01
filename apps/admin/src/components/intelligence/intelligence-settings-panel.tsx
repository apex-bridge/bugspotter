/**
 * Intelligence Settings Panel
 * Shared component used in both org member view and platform admin org detail.
 * Accepts orgId as a prop instead of relying on useOrganization context.
 */

import { useState, useCallback, useEffect, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Brain, Key, AlertTriangle, MessageSquare, Gauge } from 'lucide-react';
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

// Grace window is exposed as seconds in the UI but stored as ms server-side.
// Server clamps to [0, 300_000ms]; mirror that cap here so we don't post a
// value that'll be silently clamped.
const PRE_FILE_DEDUP_GRACE_MAX_SEC = 300;

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
  /**
   * URL the "View AI Observability dashboard" card should link to.
   * Self-service callers pass `/my-organization/intelligence/observability`.
   * Platform-admin callers can omit this — the dashboard route is currently
   * org-scoped to the current user only, so the card is hidden when no
   * caller-appropriate target exists, rather than navigating away from the
   * inspected org.
   */
  observabilityHref?: string;
}

export function IntelligenceSettingsPanel({
  orgId,
  hideHeader,
  observabilityHref,
}: IntelligenceSettingsPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showProvisionForm, setShowProvisionForm] = useState(false);
  const [threshold, setThreshold] = useState('0.75');
  const [preFileDedupGraceSec, setPreFileDedupGraceSec] = useState('0');
  // Per-channel token inputs — local-only state, never persisted in
  // the query cache (the cache holds only the `*_configured` boolean
  // signals so the plaintext token never lingers in memory longer
  // than needed). Inputs are masked (type="password") and reset on
  // successful save / cancel.
  const [telegramTokenInput, setTelegramTokenInput] = useState('');
  const [showTelegramTokenForm, setShowTelegramTokenForm] = useState(false);
  const [slackTokenInput, setSlackTokenInput] = useState('');
  const [showSlackTokenForm, setShowSlackTokenForm] = useState(false);

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

  // Store as seconds in the input; convert back to ms on submit. The
  // null branch matters: if the setting is cleared server-side, the
  // local input must follow back to '0' rather than holding the user's
  // last typed value.
  useEffect(() => {
    setPreFileDedupGraceSec(
      settings?.intelligence_pre_file_dedup_grace_ms != null
        ? String(Math.round(settings.intelligence_pre_file_dedup_grace_ms / 1000))
        : '0'
    );
  }, [settings?.intelligence_pre_file_dedup_grace_ms]);

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

  // Save / clear a per-channel bot token. Reuses `updateMutation` so
  // the success toast and query invalidation are shared with the
  // other settings paths. The plaintext token is sent to the backend
  // once on save and is encrypted before persistence — neither this
  // component nor the query cache ever holds the ciphertext.
  const handleSaveBotToken = useCallback(
    (field: 'telegram_bot_token' | 'slack_bot_token', value: string, onDone: () => void) => {
      updateMutation.mutate({ [field]: value } as UpdateIntelligenceSettingsInput, {
        onSuccess: () => onDone(),
      });
    },
    [updateMutation]
  );

  const handleClearBotToken = useCallback(
    (field: 'telegram_bot_token' | 'slack_bot_token') => {
      // `null` triggers the JSONB merge to drop the field. The
      // backend treats empty-string the same way (clear), but null
      // is the explicit signal — keep it unambiguous.
      updateMutation.mutate({ [field]: null } as UpdateIntelligenceSettingsInput);
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

  const handlePreFileDedupGraceBlur = useCallback(
    (value: string) => {
      const num = parseInt(value, 10);
      if (Number.isNaN(num) || num < 0) {
        // Revert to the last server-known value so the field doesn't
        // sit displaying invalid text the server never accepted.
        setPreFileDedupGraceSec(
          settings?.intelligence_pre_file_dedup_grace_ms != null
            ? String(Math.round(settings.intelligence_pre_file_dedup_grace_ms / 1000))
            : '0'
        );
        return;
      }
      const clamped = Math.min(num, PRE_FILE_DEDUP_GRACE_MAX_SEC);
      // Always echo the parsed/clamped value into local state so things
      // like "005" or "5.7" snap to their integer form immediately
      // instead of waiting for the server round-trip via useEffect.
      setPreFileDedupGraceSec(String(clamped));
      updateMutation.mutate({ intelligence_pre_file_dedup_grace_ms: clamped * 1000 });
    },
    [updateMutation, settings?.intelligence_pre_file_dedup_grace_ms]
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

      {/* Notification channels (per-org bot tokens) */}
      <SettingsSection
        title={t('intelligence.channels.title')}
        description={t('intelligence.channels.description')}
      >
        <div className="space-y-6">
          {/* Telegram */}
          <ChannelTokenRow
            iconElement={<MessageSquare className="h-5 w-5 text-gray-400" aria-hidden="true" />}
            label={t('intelligence.channels.telegram')}
            placeholder={t('intelligence.channels.telegramPlaceholder')}
            help={t('intelligence.channels.telegramHelp')}
            configured={settings.telegram_bot_token_configured === true}
            input={telegramTokenInput}
            onInputChange={setTelegramTokenInput}
            showForm={showTelegramTokenForm}
            onShowForm={() => setShowTelegramTokenForm(true)}
            onCancel={() => {
              setShowTelegramTokenForm(false);
              setTelegramTokenInput('');
            }}
            onSave={() =>
              handleSaveBotToken('telegram_bot_token', telegramTokenInput, () => {
                setShowTelegramTokenForm(false);
                setTelegramTokenInput('');
              })
            }
            onClear={() => {
              if (window.confirm(t('intelligence.channels.clearConfirm'))) {
                handleClearBotToken('telegram_bot_token');
              }
            }}
            busy={updateMutation.isPending}
            t={t}
          />
          {/* Slack */}
          <ChannelTokenRow
            iconElement={<MessageSquare className="h-5 w-5 text-gray-400" aria-hidden="true" />}
            label={t('intelligence.channels.slack')}
            placeholder={t('intelligence.channels.slackPlaceholder')}
            help={t('intelligence.channels.slackHelp')}
            configured={settings.slack_bot_token_configured === true}
            input={slackTokenInput}
            onInputChange={setSlackTokenInput}
            showForm={showSlackTokenForm}
            onShowForm={() => setShowSlackTokenForm(true)}
            onCancel={() => {
              setShowSlackTokenForm(false);
              setSlackTokenInput('');
            }}
            onSave={() =>
              handleSaveBotToken('slack_bot_token', slackTokenInput, () => {
                setShowSlackTokenForm(false);
                setSlackTokenInput('');
              })
            }
            onClear={() => {
              if (window.confirm(t('intelligence.channels.clearConfirm'))) {
                handleClearBotToken('slack_bot_token');
              }
            }}
            busy={updateMutation.isPending}
            t={t}
          />
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

          {settings.intelligence_dedup_enabled && (
            <div className="max-w-xs">
              <Label htmlFor="pre-file-dedup-grace">
                {t('intelligence.featureFlags.preFileDedupGrace')}
              </Label>
              <p className="text-sm text-gray-500 mb-1">
                {t('intelligence.featureFlags.preFileDedupGraceDescription')}
              </p>
              <Input
                id="pre-file-dedup-grace"
                type="number"
                min={0}
                max={PRE_FILE_DEDUP_GRACE_MAX_SEC}
                step={1}
                value={preFileDedupGraceSec}
                onChange={(e) => setPreFileDedupGraceSec(e.target.value)}
                onBlur={(e) => handlePreFileDedupGraceBlur(e.target.value)}
              />
            </div>
          )}

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

      {/* Observability link — only when a caller-appropriate target exists.
          Self-service passes the my-organization URL; platform-admin omits
          the prop so we don't navigate away from the inspected org. */}
      {observabilityHref ? (
        <Link
          to={observabilityHref}
          className="block border rounded-lg p-4 bg-white hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Gauge className="w-5 h-5 text-purple-600 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {t('intelligence.observability.linkTitle')}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {t('intelligence.observability.linkDescription')}
                </p>
              </div>
            </div>
            <span className="text-sm text-purple-700 font-medium shrink-0">
              {t('intelligence.observability.linkCta')}
            </span>
          </div>
        </Link>
      ) : null}

      {/* Deflection Stats */}
      <DeflectionStatsCard orgId={orgId} />
    </div>
  );
}

/**
 * One row for a per-org notification-channel bot token. Mirrors the
 * API-key UX above: status badge + masked input + Save / Cancel /
 * Clear buttons. Stateless — the parent owns the input value and
 * busy flag so all channels share the same `updateMutation` instance.
 *
 * Why a helper component? The two channels render identical chrome
 * with one prop differing per row (label, placeholder, configured
 * flag, mutation field name); inlining both as 90-line JSX blocks
 * back-to-back made the parent diff harder to review.
 */
interface ChannelTokenRowProps {
  iconElement: React.ReactNode;
  label: string;
  placeholder: string;
  help: string;
  configured: boolean;
  input: string;
  onInputChange: (value: string) => void;
  showForm: boolean;
  onShowForm: () => void;
  onCancel: () => void;
  onSave: () => void;
  onClear: () => void;
  busy: boolean;
  t: (key: string) => string;
}

function ChannelTokenRow({
  iconElement,
  label,
  placeholder,
  help,
  configured,
  input,
  onInputChange,
  showForm,
  onShowForm,
  onCancel,
  onSave,
  onClear,
  busy,
  t,
}: ChannelTokenRowProps) {
  // `useId` produces an SSR-stable unique id; deriving it from
  // `label` would collide across locales (the EN and RU labels for
  // the same channel hash differently, and same-locale labels would
  // need fragile slugification).
  const inputId = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {iconElement}
        <Label htmlFor={inputId} className="font-medium">
          {label}
        </Label>
        {configured ? (
          <Badge variant="success">{t('intelligence.channels.configured')}</Badge>
        ) : (
          <Badge variant="secondary">{t('intelligence.channels.notConfigured')}</Badge>
        )}
      </div>
      <p className="text-sm text-gray-500">{help}</p>
      <div className="flex flex-col gap-2">
        {configured && !showForm && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onShowForm} disabled={busy}>
              {t('intelligence.channels.replace')}
            </Button>
            <Button variant="destructive" size="sm" onClick={onClear} disabled={busy}>
              {t('intelligence.channels.clear')}
            </Button>
          </div>
        )}
        {!configured && !showForm && (
          <Button size="sm" className="w-fit" onClick={onShowForm} disabled={busy}>
            {t('intelligence.channels.configure')}
          </Button>
        )}
        {showForm && (
          <div className="flex gap-2 items-end">
            <div className="flex-1 max-w-md">
              <Input
                id={inputId}
                type="password"
                placeholder={placeholder}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                autoComplete="off"
              />
            </div>
            <Button size="sm" onClick={onSave} disabled={!input.trim() || busy}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
