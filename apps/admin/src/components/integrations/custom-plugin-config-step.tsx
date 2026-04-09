import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';

// Generic config type for custom plugins with dynamic fields
type CustomPluginConfig = Record<string, unknown>;

// Internal fields to exclude from config display
const INTERNAL_FIELDS = ['plugin_metadata'];

interface CustomPluginConfigStepProps {
  integrationName: string;
  localConfig: CustomPluginConfig;
  setLocalConfig: React.Dispatch<React.SetStateAction<CustomPluginConfig>>;
  onBack?: () => void;
  onSave: () => Promise<void>;
}

/**
 * Generic configuration step for custom code plugins
 * Allows project-specific configuration with dynamic fields
 */
export function CustomPluginConfigStep({
  integrationName,
  localConfig,
  setLocalConfig,
  onBack,
  onSave,
}: CustomPluginConfigStepProps) {
  const { t } = useTranslation();
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  // Get list of current config fields (exclude internal metadata fields)
  const configFields = Object.entries(localConfig).filter(
    ([key]) => !INTERNAL_FIELDS.includes(key)
  );

  // Helper to determine if a field should use password input type
  const isSecureField = (fieldName: string): boolean => {
    const lowerName = fieldName.toLowerCase();
    return (
      lowerName.includes('token') || lowerName.includes('secret') || lowerName.includes('password')
    );
  };

  const handleAddField = useCallback(() => {
    if (!newFieldName.trim()) {
      return;
    }

    setLocalConfig((prev) => ({
      ...prev,
      [newFieldName]: newFieldValue,
    }));

    setNewFieldName('');
    setNewFieldValue('');
  }, [newFieldName, newFieldValue, setLocalConfig]);

  const handleUpdateField = useCallback(
    (key: string, value: string) => {
      setLocalConfig((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [setLocalConfig]
  );

  const handleRemoveField = useCallback(
    (key: string) => {
      setLocalConfig(({ [key]: _, ...rest }) => rest);
    },
    [setLocalConfig]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">{integrationName}</h2>
        <p className="text-muted-foreground">
          This is a custom code plugin. All configuration and authentication logic is handled within
          the plugin code itself. You can add optional configuration fields below that will be
          available in your code via{' '}
          <code className="text-sm bg-muted px-1 py-0.5 rounded">context.config</code>.
        </p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          <strong>Note:</strong> Custom plugins are self-contained. Testing happens when the
          integration runs on actual bug reports. Add configuration fields only if your plugin code
          requires them (e.g., <code className="text-sm">serverUrl</code>,{' '}
          <code className="text-sm">apiToken</code>, <code className="text-sm">projectKey</code>).
        </AlertDescription>
      </Alert>

      {/* Existing Configuration Fields */}
      {configFields.length > 0 && (
        <div className="space-y-4 border rounded-lg p-4">
          <h3 className="font-medium">{t('integrationConfig.currentConfiguration')}</h3>
          {configFields.map(([key, value]) => (
            <div key={key} className="flex gap-2 items-start">
              <div className="flex-1 space-y-2">
                <Label htmlFor={`config-${key}`}>{key}</Label>
                <Input
                  id={`config-${key}`}
                  value={String(value)}
                  onChange={(e) => handleUpdateField(key, e.target.value)}
                  placeholder={`Enter ${key}`}
                  type={isSecureField(key) ? 'password' : 'text'}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRemoveField(key)}
                className="mt-7"
                aria-label={`Remove ${key} field`}
              >
                {t('integrationConfig.remove')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add New Field */}
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-medium">{t('integrationConfig.addConfigurationField')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="new-field-name">{t('integrationConfig.fieldName')}</Label>
            <Input
              id="new-field-name"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              placeholder={t('integrationConfig.fieldNamePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-field-value">{t('integrationConfig.fieldValue')}</Label>
            <Input
              id="new-field-value"
              value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)}
              placeholder={t('integrationConfig.fieldValuePlaceholder')}
            />
          </div>
        </div>
        <Button type="button" onClick={handleAddField} disabled={!newFieldName.trim()} size="sm">
          {t('integrationConfig.addField')}
        </Button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        {onBack && (
          <Button type="button" variant="outline" onClick={onBack}>
            {t('integrationConfig.back')}
          </Button>
        )}
        <Button type="button" onClick={onSave}>
          {t('integrationConfig.saveConfiguration')}
        </Button>
      </div>

      {configFields.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          {t('integrationConfig.noConfigurationFields')}
        </p>
      )}
    </div>
  );
}
