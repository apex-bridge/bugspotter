import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import type { AuditLogStatistics } from '../../types/audit';
import { formatNumber } from '../../utils/format';

interface StatisticsCardsProps {
  statistics: AuditLogStatistics;
}

export function StatisticsCards({ statistics }: StatisticsCardsProps) {
  const { t } = useTranslation();

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
      role="region"
      aria-label={t('auditLogs.statisticsLabel')}
    >
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm text-gray-500" id="total-logs-label">
              {t('auditLogs.totalLogs')}
            </p>
            <p className="text-3xl font-bold" aria-labelledby="total-logs-label">
              {formatNumber(statistics.total)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm text-gray-500" id="successful-logs-label">
              {t('auditLogs.successful')}
            </p>
            <p
              className="text-3xl font-bold text-green-600"
              aria-labelledby="successful-logs-label"
            >
              {formatNumber(statistics.success)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm text-gray-500" id="failed-logs-label">
              {t('auditLogs.failures')}
            </p>
            <p className="text-3xl font-bold text-red-600" aria-labelledby="failed-logs-label">
              {formatNumber(statistics.failures)}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
