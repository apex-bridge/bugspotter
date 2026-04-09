import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import type { ThrottleConfig } from '../../types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';

const GROUP_BY_HELP_KEYS: Record<NonNullable<ThrottleConfig['group_by']>, string> = {
  user: 'integrationConfig.advancedTab.groupByUserHelp',
  url: 'integrationConfig.advancedTab.groupByUrlHelp',
  error_type: 'integrationConfig.advancedTab.groupByErrorTypeHelp',
};

interface ThrottleConfigFormProps {
  config: ThrottleConfig | null;
  onChange: (config: ThrottleConfig | null) => void;
}

export function ThrottleConfigForm({ config, onChange }: ThrottleConfigFormProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = React.useState(!!config);
  const [localConfig, setLocalConfig] = React.useState<ThrottleConfig>(
    config || {
      max_per_hour: undefined,
      max_per_day: undefined,
      group_by: 'user',
      digest_mode: false,
      digest_interval_minutes: 60,
    }
  );

  // Synchronize internal state with prop changes (e.g., when editing a different rule)
  useEffect(() => {
    setEnabled(!!config);
    setLocalConfig(
      config || {
        max_per_hour: undefined,
        max_per_day: undefined,
        group_by: 'user',
        digest_mode: false,
        digest_interval_minutes: 60,
      }
    );
  }, [config]);

  const handleEnabledChange = (checked: boolean) => {
    setEnabled(checked);
    if (checked) {
      onChange(localConfig);
    } else {
      onChange(null);
    }
  };

  const handleConfigChange = (
    field: keyof ThrottleConfig,
    value: number | string | boolean | undefined
  ) => {
    const updated = { ...localConfig, [field]: value };
    setLocalConfig(updated);
    if (enabled) {
      onChange(updated);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('integrations.throttleConfig.title')}</CardTitle>
            <CardDescription>{t('integrations.throttleConfig.description')}</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="enable-throttle"
              checked={enabled}
              onCheckedChange={handleEnabledChange}
            />
            <Label htmlFor="enable-throttle" className="text-sm font-medium cursor-pointer">
              {t('integrations.throttleConfig.enableThrottling')}
            </Label>
          </div>
        </div>
      </CardHeader>
      {enabled && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Max per hour */}
            <div className="space-y-2">
              <Label htmlFor="max-per-hour">
                {t('integrations.throttleConfig.maxPerHour')}
                <span className="text-xs text-gray-500 ml-1">
                  {t('integrations.throttleConfig.optional')}
                </span>
              </Label>
              <Input
                id="max-per-hour"
                type="number"
                min="1"
                value={localConfig.max_per_hour || ''}
                onChange={(e) =>
                  handleConfigChange(
                    'max_per_hour',
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder={t('integrations.throttleConfig.placeholderHour')}
              />
            </div>

            {/* Max per day */}
            <div className="space-y-2">
              <Label htmlFor="max-per-day">
                {t('integrations.throttleConfig.maxPerDay')}
                <span className="text-xs text-gray-500 ml-1">
                  {t('integrations.throttleConfig.optional')}
                </span>
              </Label>
              <Input
                id="max-per-day"
                type="number"
                min="1"
                value={localConfig.max_per_day || ''}
                onChange={(e) =>
                  handleConfigChange(
                    'max_per_day',
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder={t('integrations.throttleConfig.placeholderDay')}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {t('integrationConfig.advancedTab.suggestedValues')}
          </p>

          {/* Group by */}
          <div className="space-y-2">
            <Label htmlFor="group-by">{t('integrations.throttleConfig.groupBy')}</Label>
            {(() => {
              const groupBy = localConfig.group_by ?? 'user';
              return (
                <>
                  <Select
                    value={groupBy}
                    onValueChange={(value) =>
                      handleConfigChange('group_by', value as 'user' | 'url' | 'error_type')
                    }
                  >
                    <SelectTrigger id="group-by">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">
                        {t('integrations.throttleConfig.groupUser')}
                      </SelectItem>
                      <SelectItem value="url">
                        {t('integrations.throttleConfig.groupUrl')}
                      </SelectItem>
                      <SelectItem value="error_type">
                        {t('integrations.throttleConfig.groupErrorType')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    {t('integrations.throttleConfig.groupByDescription')}
                  </p>
                  {GROUP_BY_HELP_KEYS[groupBy] && (
                    <p className="text-xs text-gray-500">{t(GROUP_BY_HELP_KEYS[groupBy])}</p>
                  )}
                </>
              );
            })()}
          </div>

          {/* Digest mode */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="digest-mode"
                checked={localConfig.digest_mode || false}
                onCheckedChange={(checked) => handleConfigChange('digest_mode', checked === true)}
              />
              <Label htmlFor="digest-mode" className="text-sm font-normal cursor-pointer">
                {t('integrations.throttleConfig.enableDigestMode')}
              </Label>
            </div>
            <p className="text-xs text-gray-500">
              {t('integrations.throttleConfig.digestModeDescription')}
            </p>

            {localConfig.digest_mode && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="digest-interval">
                  {t('integrations.throttleConfig.digestInterval')}
                </Label>
                <Input
                  id="digest-interval"
                  type="number"
                  min="1"
                  max="1440"
                  value={localConfig.digest_interval_minutes || 60}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (!isNaN(value) && value >= 1 && value <= 1440) {
                      handleConfigChange('digest_interval_minutes', value);
                    }
                  }}
                />
                <p className="text-xs text-gray-500">
                  {t('integrations.throttleConfig.digestIntervalDescription')}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
