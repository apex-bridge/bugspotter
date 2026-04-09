import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { RegionCard } from './region-card';
import { StorageRegionSelect } from './storage-region-select';
import type {
  DataResidencyRegion,
  StorageRegion,
  RegionInfo,
} from '../../services/data-residency-service';

interface RegionSelectionCardProps {
  regions: RegionInfo[];
  selectedRegion: DataResidencyRegion;
  selectedStorageRegion: StorageRegion | undefined;
  onRegionChange: (region: DataResidencyRegion, defaultStorage: StorageRegion) => void;
  onStorageRegionChange: (region: StorageRegion) => void;
  onSave: () => void;
  hasChanges: boolean;
  isSaving: boolean;
}

export function RegionSelectionCard({
  regions,
  selectedRegion,
  selectedStorageRegion,
  onRegionChange,
  onStorageRegionChange,
  onSave,
  hasChanges,
  isSaving,
}: RegionSelectionCardProps) {
  const { t } = useTranslation();
  const currentRegionInfo = regions.find((r) => r.id === selectedRegion);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pages.data_residency.policy_configuration')}</CardTitle>
        <CardDescription>{t('pages.data_residency.policy_description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Region Selection */}
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-3">
              {t('pages.data_residency.select_region')}
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {regions.map((region) => (
                <RegionCard
                  key={region.id}
                  region={region}
                  isSelected={selectedRegion === region.id}
                  onSelect={() => onRegionChange(region.id, region.defaultStorageRegion)}
                />
              ))}
            </div>
          </fieldset>

          {/* Storage Region Selection */}
          {currentRegionInfo && currentRegionInfo.storageRegions.length > 1 && (
            <StorageRegionSelect
              storageRegions={currentRegionInfo.storageRegions}
              selectedRegion={selectedStorageRegion}
              defaultRegion={currentRegionInfo.defaultStorageRegion}
              onChange={onStorageRegionChange}
            />
          )}

          {/* Save Button */}
          <div className="flex items-center gap-3 pt-4 border-t">
            <Button onClick={onSave} disabled={!hasChanges || isSaving} isLoading={isSaving}>
              {t('common.save_changes')}
            </Button>
            {hasChanges && (
              <span className="text-sm text-gray-600">
                {t('pages.data_residency.unsaved_changes')}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
