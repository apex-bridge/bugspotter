import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { PolicyDetailItem } from './policy-detail-item';
import type { DataResidencyPolicy } from '../../services/data-residency-service';

interface CurrentPolicyCardProps {
  policy: DataResidencyPolicy;
}

export function CurrentPolicyCard({ policy }: CurrentPolicyCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pages.data_residency.current_policy')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PolicyDetailItem
            label={t('pages.data_residency.region')}
            value={policy.region.toUpperCase()}
          />
          <PolicyDetailItem
            label={t('pages.data_residency.storage_region')}
            value={policy.storageRegion}
          />
          <PolicyDetailItem
            label={t('pages.data_residency.cross_region_backup')}
            value={
              <Badge variant={policy.allowCrossRegionBackup ? 'success' : 'secondary'}>
                {policy.allowCrossRegionBackup ? t('common.allowed') : t('common.blocked')}
              </Badge>
            }
          />
          <PolicyDetailItem
            label={t('pages.data_residency.encryption')}
            value={
              <Badge variant={policy.encryptionRequired ? 'success' : 'secondary'}>
                {policy.encryptionRequired ? t('common.required') : t('common.optional')}
              </Badge>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
