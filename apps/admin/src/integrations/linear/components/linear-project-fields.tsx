/**
 * Linear per-project configuration fields.
 *
 * Used inside `ProjectIntegrationConfigPage` to render the
 * Configuration + Credentials cards when `platform === 'linear'`.
 * The card chrome itself stays in the parent — this component only
 * renders the field inputs, so the parent's layout and spacing rules
 * apply uniformly across platforms.
 *
 * Field shape mirrors the backend `LinearProjectConfig`:
 *   - Non-sensitive: teamId (UUID), teamKey (e.g. "ENG")
 *   - Credentials: apiKey (encrypted at rest)
 */

import { useTranslation } from 'react-i18next';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

interface LinearProjectFieldsProps {
  config: Record<string, string>;
  credentials: Record<string, string>;
  savedCredentialHints: Record<string, string>;
  onConfigChange: (key: string, value: string) => void;
  onCredentialChange: (key: string, value: string) => void;
}

export function LinearProjectFields({
  config,
  credentials,
  savedCredentialHints,
  onConfigChange,
  onCredentialChange,
}: LinearProjectFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="linear-team-key">{t('linearConfig.teamKey')}</Label>
        <Input
          id="linear-team-key"
          placeholder={t('linearConfig.teamKeyPlaceholder')}
          value={config.teamKey || ''}
          onChange={(e) => onConfigChange('teamKey', e.target.value)}
        />
        <p className="text-xs text-gray-500">{t('linearConfig.teamKeyHelp')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="linear-team-id">{t('linearConfig.teamId')}</Label>
        <Input
          id="linear-team-id"
          placeholder={t('linearConfig.teamIdPlaceholder')}
          value={config.teamId || ''}
          onChange={(e) => onConfigChange('teamId', e.target.value)}
        />
        <p className="text-xs text-gray-500">{t('linearConfig.teamIdHelp')}</p>
      </div>

      <div className="space-y-2 pt-4 border-t">
        <div className="flex items-center gap-2">
          <Label htmlFor="linear-api-key">{t('linearConfig.apiKey')}</Label>
          {savedCredentialHints.apiKey && (
            <span className="text-xs text-green-600" id="linear-api-key-saved-hint">
              {t('integrationConfig.savedOnServer')}
            </span>
          )}
        </div>
        <Input
          id="linear-api-key"
          type="password"
          placeholder={savedCredentialHints.apiKey || t('linearConfig.apiKeyPlaceholder')}
          aria-describedby={savedCredentialHints.apiKey ? 'linear-api-key-saved-hint' : undefined}
          value={credentials.apiKey || ''}
          onChange={(e) => onCredentialChange('apiKey', e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-gray-500">{t('linearConfig.apiKeyHelp')}</p>
      </div>
    </>
  );
}
