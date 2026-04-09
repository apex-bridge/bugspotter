import { useTranslation } from 'react-i18next';
import { Globe, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { STRICT_REGIONS, type RegionInfo } from '../../services/data-residency-service';

interface RegionCardProps {
  region: RegionInfo;
  isSelected: boolean;
  onSelect: () => void;
}

export function RegionCard({ region, isSelected, onSelect }: RegionCardProps) {
  const { t } = useTranslation();
  const isStrict = STRICT_REGIONS.has(region.id);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`region-card-${region.id}`}
      className={cn(
        'p-4 border-2 rounded-lg text-left transition-all',
        isSelected
          ? 'border-blue-600 bg-blue-50 shadow-md'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {region.id === 'global' ? (
            <Globe className="h-6 w-6 text-gray-600" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-6 w-6 text-blue-600" aria-hidden="true" />
          )}
          <span className="font-semibold text-gray-900">
            {t(`pages.data_residency.regions.${region.id}`)}
          </span>
        </div>
        {isStrict && <Badge variant="secondary">{t('pages.data_residency.strict')}</Badge>}
      </div>
      <div className="text-xs text-gray-600 space-y-1">
        <div>
          {t('pages.data_residency.cross_region_backup')}:{' '}
          {region.allowCrossRegionBackup ? t('common.yes') : t('common.no')}
        </div>
        <div>
          {t('pages.data_residency.encryption')}:{' '}
          {region.encryptionRequired ? t('common.required') : t('common.optional')}
        </div>
      </div>
    </button>
  );
}
