/**
 * Feature Flags Settings Section
 */

import { useTranslation } from 'react-i18next';
import { SettingsSection } from './settings-section';
import type { InstanceSettings } from '../../types';

interface FeatureSettingsProps {
  formData: Partial<InstanceSettings>;
  updateField: <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => void;
}

export function FeatureSettingsSection({ formData, updateField }: FeatureSettingsProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('settings.featureSettings.title')}
      description={t('settings.featureSettings.description')}
    >
      <label className="flex items-center space-x-3 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.session_replay_enabled || false}
          onChange={(e) => updateField('session_replay_enabled', e.target.checked)}
          className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
        />
        <div>
          <p className="font-medium">{t('settings.featureSettings.sessionReplay')}</p>
          <p className="text-sm text-gray-500">
            {t('settings.featureSettings.sessionReplayDescription')}
          </p>
        </div>
      </label>
    </SettingsSection>
  );
}
