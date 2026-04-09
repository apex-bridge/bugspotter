import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { ThrottleConfig } from '../../types';
import { ThrottleConfigForm } from './throttle-config-form';

interface AdvancedTabProps {
  throttleConfig: ThrottleConfig | null;
  onThrottleConfigChange: (config: ThrottleConfig | null) => void;
}

export function AdvancedTab({ throttleConfig, onThrottleConfigChange }: AdvancedTabProps) {
  const { t } = useTranslation();
  return (
    <div className="py-4">
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-1">
          {t('integrationConfig.advancedTab.throttlingSettings')}
        </h3>
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('integrationConfig.advancedTab.introBanner')}</span>
        </div>
      </div>
      <ThrottleConfigForm config={throttleConfig} onChange={onThrottleConfigChange} />
    </div>
  );
}
