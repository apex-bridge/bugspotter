import { useTranslation } from 'react-i18next';
import type { StorageRegion } from '../../services/data-residency-service';

interface StorageRegionSelectProps {
  storageRegions: StorageRegion[];
  selectedRegion: StorageRegion | undefined;
  defaultRegion: StorageRegion;
  onChange: (region: StorageRegion) => void;
}

export function StorageRegionSelect({
  storageRegions,
  selectedRegion,
  defaultRegion,
  onChange,
}: StorageRegionSelectProps) {
  const { t } = useTranslation();

  return (
    <div>
      <label
        htmlFor="storage-region-select"
        className="block text-sm font-medium text-gray-700 mb-2"
      >
        {t('pages.data_residency.storage_region')}
      </label>
      <select
        id="storage-region-select"
        value={selectedRegion}
        onChange={(e) => onChange(e.target.value as StorageRegion)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {storageRegions.map((sr) => (
          <option key={sr} value={sr}>
            {sr}
            {sr === defaultRegion && ` (${t('common.default')})`}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500 mt-1">{t('pages.data_residency.storage_region_hint')}</p>
    </div>
  );
}
