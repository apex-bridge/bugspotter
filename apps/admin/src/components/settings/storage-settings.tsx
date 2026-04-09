/**
 * Storage Settings Section
 */

import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { SettingsSection } from './settings-section';
import type { InstanceSettings } from '../../types';

interface StorageSettingsProps {
  formData: Partial<InstanceSettings>;
  updateField: <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => void;
}

export function StorageSettingsSection({ formData, updateField }: StorageSettingsProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('settings.storageSettings.title')}
      description={t('settings.storageSettings.description')}
      className="space-y-4"
    >
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          {t('settings.storageSettings.storageType')}
        </label>
        <div className="flex gap-4">
          <label className="flex items-center cursor-pointer">
            <input
              type="radio"
              value="minio"
              checked={formData.storage_type === 'minio'}
              onChange={(e) => updateField('storage_type', e.target.value as 'minio')}
              className="mr-2"
            />
            {t('settings.storageSettings.minio')}
          </label>
          <label className="flex items-center cursor-pointer">
            <input
              type="radio"
              value="s3"
              checked={formData.storage_type === 's3'}
              onChange={(e) => updateField('storage_type', e.target.value as 's3')}
              className="mr-2"
            />
            {t('settings.storageSettings.awsS3')}
          </label>
        </div>
      </div>

      {formData.storage_type === 'minio' && (
        <Input
          label={t('settings.storageSettings.minioEndpoint')}
          type="url"
          value={formData.storage_endpoint || ''}
          onChange={(e) => updateField('storage_endpoint', e.target.value)}
          placeholder={t('settings.storageSettings.minioEndpointPlaceholder')}
          required
        />
      )}

      <Input
        label={t('settings.storageSettings.bucketName')}
        value={formData.storage_bucket || ''}
        onChange={(e) => updateField('storage_bucket', e.target.value)}
        placeholder={t('settings.storageSettings.bucketNamePlaceholder')}
        required
      />

      {formData.storage_type === 's3' && (
        <Input
          label={t('settings.storageSettings.awsRegion')}
          value={formData.storage_region || ''}
          onChange={(e) => updateField('storage_region', e.target.value)}
          placeholder={t('settings.storageSettings.awsRegionPlaceholder')}
          required
        />
      )}
    </SettingsSection>
  );
}
