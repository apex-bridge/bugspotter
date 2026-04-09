import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { adminService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { Button } from '../components/ui/button';
import { Save } from 'lucide-react';
import { InstanceSettingsSection } from '../components/settings/instance-settings';
import { StorageSettingsSection } from '../components/settings/storage-settings';
import { SecuritySettingsSection } from '../components/settings/security-settings';
import { RetentionSettingsSection } from '../components/settings/retention-settings';
import { FeatureSettingsSection } from '../components/settings/feature-settings';
import { ReplayDurationSettings } from '../components/settings/replay-duration-settings';
import { ReplayQualitySettings } from '../components/settings/replay-quality-settings';
import { VersionDisplay } from '../components/version-display';
import type { InstanceSettings } from '../types';

export default function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Partial<InstanceSettings>>({});
  const [corsInput, setCorsInput] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: adminService.getSettings,
  });

  // Initialize form data when settings are loaded (proper useEffect)
  useEffect(() => {
    if (data) {
      setFormData(data);
      const origins = data.cors_origins;
      setCorsInput(Array.isArray(origins) ? origins.join(', ') : '');
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: adminService.updateSettings,
    onSuccess: (updatedSettings) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      // Reset form to server values after successful update
      setFormData(updatedSettings);
      const origins = updatedSettings.cors_origins;
      setCorsInput(Array.isArray(origins) ? origins.join(', ') : '');
      toast.success(t('pages.savedSuccessfully'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  // Memoize updateField to prevent unnecessary re-renders
  const updateField = useCallback(
    <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleCorsInputChange = useCallback((value: string) => {
    setCorsInput(value);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const dataToSend = {
        ...formData,
        cors_origins: corsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      updateMutation.mutate(dataToSend);
    },
    [formData, corsInput, updateMutation]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('pages.settings')}</h1>
          <p className="text-gray-500 mt-1">{t('pages.configureInstance')}</p>
        </div>
        <VersionDisplay />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <InstanceSettingsSection formData={formData} updateField={updateField} />

        <StorageSettingsSection formData={formData} updateField={updateField} />

        <SecuritySettingsSection
          formData={formData}
          corsInput={corsInput}
          updateField={updateField}
          onCorsInputChange={handleCorsInputChange}
        />

        <RetentionSettingsSection formData={formData} updateField={updateField} />

        <FeatureSettingsSection formData={formData} updateField={updateField} />

        <ReplayDurationSettings formData={formData} updateField={updateField} />

        <ReplayQualitySettings formData={formData} updateField={updateField} />

        <div className="flex justify-end">
          <Button type="submit" isLoading={updateMutation.isPending} size="lg">
            <Save className="w-4 h-4 mr-2" />
            {t('pages.saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  );
}
