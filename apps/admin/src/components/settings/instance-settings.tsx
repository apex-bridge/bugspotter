/**
 * Instance Configuration Settings Section
 */

import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { SettingsSection } from './settings-section';
import type { InstanceSettings } from '../../types';

interface InstanceSettingsProps {
  formData: Partial<InstanceSettings>;
  updateField: <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => void;
}

export function InstanceSettingsSection({ formData, updateField }: InstanceSettingsProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('settings.instanceConfiguration.title')}
      description={t('settings.instanceConfiguration.description')}
      className="space-y-4"
    >
      <Input
        label={t('settings.instanceConfiguration.instanceName')}
        value={formData.instance_name || ''}
        onChange={(e) => updateField('instance_name', e.target.value)}
        required
      />
      <Input
        label={t('settings.instanceConfiguration.instanceUrl')}
        type="url"
        value={formData.instance_url || ''}
        onChange={(e) => updateField('instance_url', e.target.value)}
        placeholder={t('settings.instanceConfiguration.instanceUrlPlaceholder')}
        required
      />
      <Input
        label={t('settings.instanceConfiguration.supportEmail')}
        type="email"
        value={formData.support_email || ''}
        onChange={(e) => updateField('support_email', e.target.value)}
        placeholder={t('settings.instanceConfiguration.supportEmailPlaceholder')}
        required
      />
    </SettingsSection>
  );
}
