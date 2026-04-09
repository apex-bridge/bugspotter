/**
 * Security Settings Section
 */

import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { SettingsSection } from './settings-section';
import type { InstanceSettings } from '../../types';

interface SecuritySettingsProps {
  formData: Partial<InstanceSettings>;
  corsInput: string;
  updateField: <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => void;
  onCorsInputChange: (value: string) => void;
}

export function SecuritySettingsSection({
  formData,
  corsInput,
  updateField,
  onCorsInputChange,
}: SecuritySettingsProps) {
  const { t } = useTranslation();

  const handleNumberChange = (field: keyof InstanceSettings, value: string, min: number = 0) => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= min) {
      updateField(field, parsed as InstanceSettings[typeof field]);
    }
  };

  return (
    <SettingsSection
      title={t('settings.securitySettings.title')}
      description={t('settings.securitySettings.description')}
      className="space-y-4"
    >
      <Input
        label={t('settings.securitySettings.jwtAccessTokenExpiry')}
        type="number"
        min="60"
        max="86400"
        value={formData.jwt_access_expiry || ''}
        onChange={(e) => handleNumberChange('jwt_access_expiry', e.target.value, 60)}
        placeholder="3600"
      />
      <Input
        label={t('settings.securitySettings.jwtRefreshTokenExpiry')}
        type="number"
        min="3600"
        max="2592000"
        value={formData.jwt_refresh_expiry || ''}
        onChange={(e) => handleNumberChange('jwt_refresh_expiry', e.target.value, 3600)}
        placeholder="604800"
      />
      <Input
        label={t('settings.securitySettings.rateLimitMaxRequests')}
        type="number"
        min="1"
        max="10000"
        value={formData.rate_limit_max || ''}
        onChange={(e) => handleNumberChange('rate_limit_max', e.target.value, 1)}
        placeholder="100"
      />
      <Input
        label={t('settings.securitySettings.rateLimitWindow')}
        type="number"
        min="1"
        max="3600"
        value={formData.rate_limit_window || ''}
        onChange={(e) => handleNumberChange('rate_limit_window', e.target.value, 1)}
        placeholder="60"
      />
      <Input
        label={t('settings.securitySettings.corsOrigins')}
        value={corsInput}
        onChange={(e) => onCorsInputChange(e.target.value)}
        placeholder="https://example.com, https://app.example.com"
      />
    </SettingsSection>
  );
}
