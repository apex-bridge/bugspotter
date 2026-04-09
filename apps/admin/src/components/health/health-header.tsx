import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Download, RefreshCw } from 'lucide-react';

// Type for translation function with optional interpolation options
type TFunction = (key: string, options?: Record<string, unknown>) => string;

interface HealthHeaderProps {
  lastUpdated: Date;
  isRefreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
  getTimeAgo: (date: Date, t: TFunction) => string;
}

export const HealthHeader: React.FC<HealthHeaderProps> = ({
  lastUpdated,
  isRefreshing,
  onRefresh,
  onExport,
  getTimeAgo,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">{t('pages.systemHealth')}</h1>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-gray-500">{t('pages.realtimeMonitoring')}</p>
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {t('pages.updated')} {getTimeAgo(lastUpdated, t)}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onExport}
          className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
          aria-label="Export health snapshot as JSON"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          {t('pages.export')}
        </button>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={`px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 ${isRefreshing ? 'opacity-50' : ''}`}
          aria-label="Manually refresh system health data"
        >
          <RefreshCw
            className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {t('pages.refresh')}
        </button>
      </div>
    </div>
  );
};

export default HealthHeader;
