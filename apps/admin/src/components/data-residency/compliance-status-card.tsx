import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { MetricCard } from './metric-card';
import { ViolationItem } from './violation-item';
import type { ComplianceSummary } from '../../services/data-residency-service';

interface ComplianceStatusCardProps {
  summary: ComplianceSummary;
}

export function ComplianceStatusCard({ summary }: ComplianceStatusCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" data-testid="compliance-status-heading">
          {summary.isCompliant ? (
            <CheckCircle className="h-6 w-6 text-green-600" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-6 w-6 text-yellow-600" aria-hidden="true" />
          )}
          {t('pages.data_residency.compliance_status')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label={t('pages.data_residency.status')}
            value={
              <Badge variant={summary.isCompliant ? 'success' : 'destructive'}>
                {summary.isCompliant
                  ? t('pages.data_residency.compliant')
                  : t('pages.data_residency.needs_attention')}
              </Badge>
            }
          />
          <MetricCard
            label={t('pages.data_residency.violations_24h')}
            value={summary.violations.count}
          />
          <MetricCard
            label={t('pages.data_residency.audit_entries_24h')}
            value={summary.auditEntries.count}
          />
        </div>

        {summary.violations.recent.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              {t('pages.data_residency.recent_violations')}
            </h4>
            <div className="space-y-2">
              {summary.violations.recent.map((violation) => (
                <ViolationItem key={violation.id} violation={violation} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
