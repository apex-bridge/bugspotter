/**
 * Project Integration Configuration Page
 * Configure credentials and settings for a specific integration on a specific project
 */

import { useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, TestTube, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select-radix';
import projectIntegrationService from '../services/project-integration-service';
import { useProjectPermissions } from '../hooks/use-project-permissions';
import { handleApiError } from '../lib/api-client';

interface TemplateConfig {
  includeConsoleLogs?: boolean;
  consoleLogLimit?: number;
  includeNetworkLogs?: boolean;
  networkLogFilter?: 'all' | 'failures';
  networkLogLimit?: number;
  includeShareReplay?: boolean;
  shareReplayExpiration?: number;
  shareReplayPassword?: string;
}

export default function ProjectIntegrationConfigPage() {
  const { t } = useTranslation();
  const { projectId, platform } = useParams<{ projectId: string; platform: string }>();

  // Validate params early - must be before any conditional hooks
  const isInvalidParam = (param: string | undefined): boolean => {
    if (!param) {
      return true;
    }
    if (param.trim() === '') {
      return true;
    }
    return false;
  };

  if (isInvalidParam(platform) || isInvalidParam(projectId)) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-red-600" data-testid="error-message">
          Missing platform or project ID
        </p>
      </div>
    );
  }

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManageIntegrations } = useProjectPermissions(projectId);

  const [config, setConfig] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>({});
  // Track which credential fields have saved values on the server (key → masked hint)
  const [savedCredentialHints, setSavedCredentialHints] = useState<Record<string, string>>({});
  // Track which credential fields were touched by the user in this session
  const [touchedCredentials, setTouchedCredentials] = useState<Set<string>>(new Set());
  // Preserve non-string config values (booleans, objects) loaded from DB so they aren't lost on save
  const baseConfigRef = useRef<Record<string, unknown>>({});

  // Load existing configuration
  const { isLoading } = useQuery({
    queryKey: ['project-integration', platform, projectId],
    queryFn: async () => {
      if (!platform || !projectId) {
        return null;
      }
      const data = await projectIntegrationService.get(platform, projectId);
      if (data?.config) {
        const cfg = data.config as Record<string, unknown>;
        // Preserve all original values for merging on save
        baseConfigRef.current = { ...cfg };
        // Initialize templateConfig with defaults for Jira so UI state matches persisted state
        const defaultTemplateConfig: TemplateConfig = {
          includeConsoleLogs: false,
          consoleLogLimit: 10,
          includeNetworkLogs: false,
          networkLogFilter: 'failures',
          networkLogLimit: 10,
          includeShareReplay: true,
          shareReplayExpiration: 720,
        };
        if (cfg.templateConfig && typeof cfg.templateConfig === 'object') {
          setTemplateConfig({
            ...defaultTemplateConfig,
            ...(cfg.templateConfig as TemplateConfig),
          });
        } else if (platform === 'jira') {
          setTemplateConfig(defaultTemplateConfig);
        }
        // Build flat string config for form inputs (excluding templateConfig)
        const flatConfig: Record<string, string> = {};
        for (const [key, value] of Object.entries(cfg)) {
          if (key !== 'templateConfig' && typeof value === 'string') {
            flatConfig[key] = value;
          }
        }
        setConfig(flatConfig);
      }
      if (
        data?.credential_hints &&
        typeof data.credential_hints === 'object' &&
        !Array.isArray(data.credential_hints)
      ) {
        setSavedCredentialHints(data.credential_hints as Record<string, string>);
      } else {
        setSavedCredentialHints({});
      }
      setTouchedCredentials(new Set());
      return data;
    },
    enabled: !!platform && !!projectId,
  });

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: async () => {
      if (!platform) {
        throw new Error('Platform not specified');
      }
      return await projectIntegrationService.testConnection(platform, {
        ...config,
        ...credentials,
      });
    },
    onSuccess: () => {
      toast.success('Connection test successful!');
    },
    onError: (error) => {
      toast.error(`${t('errors.connectionTestFailed')}: ${handleApiError(error)}`);
    },
  });

  // Save configuration mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!platform || !projectId) {
        throw new Error('Missing platform or project ID');
      }
      const hasTemplateConfig = Object.keys(templateConfig).length > 0;
      // Merge: base config (preserves booleans etc.) + form string values + templateConfig
      const configToSave = {
        ...baseConfigRef.current,
        ...config,
        ...(hasTemplateConfig ? { templateConfig } : {}),
      };
      // Only send credentials that were actually changed by the user
      const credentialsToSave: Record<string, string> = {};
      for (const key of touchedCredentials) {
        credentialsToSave[key] = credentials[key] || '';
      }
      return await projectIntegrationService.configure(platform, projectId, {
        config: configToSave,
        credentials: credentialsToSave,
        enabled: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-integration', platform, projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-integrations', projectId] });
      toast.success('Configuration saved successfully!');
      navigate(`/projects/${projectId}/integrations`);
    },
    onError: (error) => {
      toast.error(`${t('errors.failedToSaveConfiguration')}: ${handleApiError(error)}`);
    },
  });

  // Delete configuration mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!platform || !projectId) {
        throw new Error('Missing platform or project ID');
      }
      return await projectIntegrationService.delete(platform, projectId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-integrations', projectId] });
      toast.success('Configuration deleted successfully!');
      navigate(`/projects/${projectId}/integrations`);
    },
    onError: (error) => {
      toast.error(`${t('errors.failedToDeleteConfiguration')}: ${handleApiError(error)}`);
    },
  });

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateTemplateField = useCallback(
    <K extends keyof TemplateConfig>(key: K, value: TemplateConfig[K]) => {
      setTemplateConfig((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateCredentials = (key: string, value: string) => {
    setTouchedCredentials((prev) => new Set(prev).add(key));
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/integrations`)}
              aria-label={t('integrationConfig.backToIntegrations')}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <h1 className="text-3xl font-bold">
              {t('integrationConfig.configureIntegration', {
                name: platform?.replace('_', ' ').toUpperCase(),
              })}
            </h1>
          </div>
          <p className="text-gray-600">{t('integrationConfig.setupCredentials')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <div
            className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"
            role="status"
            aria-live="polite"
          ></div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Configuration Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t('integrationConfig.configuration')}</CardTitle>
              <CardDescription>{t('integrationConfig.configNonSensitive')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="instance-url">{t('integrationConfig.instanceUrl')}</Label>
                <Input
                  id="instance-url"
                  type="url"
                  placeholder="https://your-instance.atlassian.net"
                  value={config.instanceUrl || ''}
                  onChange={(e) => updateConfig('instanceUrl', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-key">{t('integrationConfig.projectKey')}</Label>
                <Input
                  id="project-key"
                  placeholder="PROJ"
                  value={config.projectKey || ''}
                  onChange={(e) => updateConfig('projectKey', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-json">{t('integrationConfig.additionalConfig')}</Label>
                <Textarea
                  id="config-json"
                  placeholder={t('integrationConfig.additionalConfigPlaceholder')}
                  value={config.additionalConfig || ''}
                  onChange={(e) => updateConfig('additionalConfig', e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-gray-500">
                  {t('integrationConfig.additionalConfigHint')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Credentials Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t('integrationConfig.credentialsTitle')}</CardTitle>
              <CardDescription>{t('integrationConfig.credentialsSensitive')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="email">{t('integrationConfig.email')}</Label>
                  {savedCredentialHints.email && (
                    <span className="text-xs text-green-600" id="email-saved-hint">
                      {t('integrationConfig.savedOnServer')}
                    </span>
                  )}
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder={
                    savedCredentialHints.email || t('integrationConfig.emailPlaceholder')
                  }
                  aria-describedby={savedCredentialHints.email ? 'email-saved-hint' : undefined}
                  value={credentials.email || ''}
                  onChange={(e) => updateCredentials('email', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="api-token">{t('integrationConfig.apiToken')}</Label>
                  {savedCredentialHints.apiToken && (
                    <span className="text-xs text-green-600" id="api-token-saved-hint">
                      {t('integrationConfig.savedOnServer')}
                    </span>
                  )}
                </div>
                <Input
                  id="api-token"
                  type="password"
                  placeholder={
                    savedCredentialHints.apiToken || t('integrationConfig.apiTokenPlaceholder')
                  }
                  aria-describedby={
                    savedCredentialHints.apiToken ? 'api-token-saved-hint' : undefined
                  }
                  value={credentials.apiToken || ''}
                  onChange={(e) => updateCredentials('apiToken', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="password">{t('integrationConfig.password')}</Label>
                  {savedCredentialHints.password && (
                    <span className="text-xs text-green-600" id="password-saved-hint">
                      {t('integrationConfig.savedOnServer')}
                    </span>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder={
                    savedCredentialHints.password || t('integrationConfig.passwordPlaceholder')
                  }
                  aria-describedby={
                    savedCredentialHints.password ? 'password-saved-hint' : undefined
                  }
                  value={credentials.password || ''}
                  onChange={(e) => updateCredentials('password', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Ticket Content Settings (Jira-specific) */}
      {platform === 'jira' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('integrationConfig.ticketContentTitle')}</CardTitle>
            <CardDescription>{t('integrationConfig.ticketContentDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              {/* Console Logs */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="include-console-logs"
                    checked={templateConfig.includeConsoleLogs ?? false}
                    onCheckedChange={(checked) =>
                      updateTemplateField('includeConsoleLogs', !!checked)
                    }
                  />
                  <Label htmlFor="include-console-logs">
                    {t('integrationConfig.includeConsoleLogs')}
                  </Label>
                </div>
                {templateConfig.includeConsoleLogs && (
                  <div className="space-y-1 pl-6">
                    <Label htmlFor="console-log-limit" className="text-xs text-gray-500">
                      {t('integrationConfig.maxEntries')}
                    </Label>
                    <Input
                      id="console-log-limit"
                      type="number"
                      min={1}
                      max={50}
                      value={templateConfig.consoleLogLimit ?? 10}
                      onChange={(e) =>
                        updateTemplateField('consoleLogLimit', parseInt(e.target.value) || 10)
                      }
                      className="w-24"
                    />
                  </div>
                )}
              </div>

              {/* Network Logs */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="include-network-logs"
                    checked={templateConfig.includeNetworkLogs ?? false}
                    onCheckedChange={(checked) =>
                      updateTemplateField('includeNetworkLogs', !!checked)
                    }
                  />
                  <Label htmlFor="include-network-logs">
                    {t('integrationConfig.includeNetworkLogs')}
                  </Label>
                </div>
                {templateConfig.includeNetworkLogs && (
                  <div className="space-y-2 pl-6">
                    <div className="space-y-1">
                      <Label htmlFor="network-log-filter" className="text-xs text-gray-500">
                        {t('integrationConfig.networkFilter')}
                      </Label>
                      <Select
                        value={templateConfig.networkLogFilter ?? 'failures'}
                        onValueChange={(v) =>
                          updateTemplateField('networkLogFilter', v as 'all' | 'failures')
                        }
                      >
                        <SelectTrigger id="network-log-filter" className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="failures">
                            {t('integrationConfig.networkFilterFailures')}
                          </SelectItem>
                          <SelectItem value="all">
                            {t('integrationConfig.networkFilterAll')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="network-log-limit" className="text-xs text-gray-500">
                        {t('integrationConfig.maxEntries')}
                      </Label>
                      <Input
                        id="network-log-limit"
                        type="number"
                        min={1}
                        max={50}
                        value={templateConfig.networkLogLimit ?? 10}
                        onChange={(e) =>
                          updateTemplateField('networkLogLimit', parseInt(e.target.value) || 10)
                        }
                        className="w-24"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Session Replay */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="include-share-replay"
                    checked={templateConfig.includeShareReplay ?? true}
                    onCheckedChange={(checked) =>
                      updateTemplateField('includeShareReplay', !!checked)
                    }
                  />
                  <Label htmlFor="include-share-replay">
                    {t('integrationConfig.includeShareReplay')}
                  </Label>
                </div>
                {(templateConfig.includeShareReplay ?? true) && (
                  <div className="space-y-2 pl-6">
                    <div className="space-y-1">
                      <Label htmlFor="replay-expiration" className="text-xs text-gray-500">
                        {t('integrationConfig.replayExpiration')}
                      </Label>
                      <Select
                        value={String(templateConfig.shareReplayExpiration ?? 720)}
                        onValueChange={(v) =>
                          updateTemplateField('shareReplayExpiration', parseInt(v))
                        }
                      >
                        <SelectTrigger id="replay-expiration" className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24">24h</SelectItem>
                          <SelectItem value="168">7 {t('integrationConfig.days')}</SelectItem>
                          <SelectItem value="720">30 {t('integrationConfig.days')}</SelectItem>
                          <SelectItem value="2160">90 {t('integrationConfig.days')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="replay-password" className="text-xs text-gray-500">
                        {t('integrationConfig.replayPassword')}
                      </Label>
                      <Input
                        id="replay-password"
                        type="password"
                        placeholder={t('integrationConfig.replayPasswordPlaceholder')}
                        value={templateConfig.shareReplayPassword ?? ''}
                        onChange={(e) =>
                          updateTemplateField('shareReplayPassword', e.target.value || undefined)
                        }
                        className="w-48"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={!canManageIntegrations || deleteMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('integrationConfig.deleteConfiguration')}
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={!canManageIntegrations || testMutation.isPending}
              >
                <TestTube className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('integrationConfig.testConnection')}
              </Button>

              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!canManageIntegrations || saveMutation.isPending}
                data-testid="save-config-button"
              >
                <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('integrationConfig.saveConfiguration')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              <Trans
                i18nKey="integrationConfig.infoConfiguration"
                components={{ strong: <strong /> }}
              />
            </p>
            <p>
              <Trans
                i18nKey="integrationConfig.infoCredentials"
                components={{ strong: <strong /> }}
              />
            </p>
            <p>
              <Trans
                i18nKey="integrationConfig.infoTestConnection"
                components={{ strong: <strong /> }}
              />
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
