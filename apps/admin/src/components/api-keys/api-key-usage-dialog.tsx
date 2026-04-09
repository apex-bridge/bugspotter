import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent } from '../ui/card';
import { Activity, TrendingUp, Calendar, CalendarDays } from 'lucide-react';
import { formatNumber, formatDate } from '../../utils/format';
import type { ApiKeyUsage } from '../../types/api-keys';

const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface ApiKeyUsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usage: ApiKeyUsage | null;
  isLoading: boolean;
}

export function ApiKeyUsageDialog({
  open,
  onOpenChange,
  usage,
  isLoading,
}: ApiKeyUsageDialogProps) {
  const { t } = useTranslation();
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus management
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else {
      previousFocusRef.current?.focus();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-labelledby="usage-dialog-title" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle id="usage-dialog-title">{t('apiKeys.usageDialog.title')}</DialogTitle>
          <DialogDescription>{t('apiKeys.usageDialog.description')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8" role="status" aria-live="polite">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
            <span className="sr-only">{t('apiKeys.usageDialog.loadingStatistics')}</span>
          </div>
        ) : usage ? (
          <div className="space-y-4">
            {/* Key Info */}
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">{t('apiKeys.usageDialog.name')}</span> {usage.name}
              </div>
              <div className="text-sm">
                <span className="font-medium">{t('apiKeys.usageDialog.created')}</span>{' '}
                {formatDate(usage.created_at)}
              </div>
              <div className="text-sm">
                <span className="font-medium">{t('apiKeys.usageDialog.lastUsed')}</span>{' '}
                {usage.last_used_at
                  ? formatDate(usage.last_used_at)
                  : t('apiKeys.usageDialog.never')}
              </div>
            </div>

            {/* Usage Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-blue-600" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">
                        {t('apiKeys.usageDialog.totalRequests')}
                      </p>
                      <p className="text-2xl font-bold">{formatNumber(usage.total_requests)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-green-600" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">
                        {t('apiKeys.usageDialog.last24Hours')}
                      </p>
                      <p className="text-2xl font-bold">{formatNumber(usage.requests_last_24h)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-purple-600" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">{t('apiKeys.usageDialog.last7Days')}</p>
                      <p className="text-2xl font-bold">{formatNumber(usage.requests_last_7d)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <CalendarDays className="w-5 h-5 text-orange-600" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">{t('apiKeys.usageDialog.last30Days')}</p>
                      <p className="text-2xl font-bold">{formatNumber(usage.requests_last_30d)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Usage Summary */}
            <Card className="bg-gray-50">
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm mb-2">
                  {t('apiKeys.usageDialog.usageSummary')}
                </h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>{t('apiKeys.usageDialog.avgRequestsPerDay30d')}</span>
                    <span className="font-medium">
                      {formatNumber(Math.round(usage.requests_last_30d / DAYS_IN_MONTH))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('apiKeys.usageDialog.avgRequestsPerDay7d')}</span>
                    <span className="font-medium">
                      {formatNumber(Math.round(usage.requests_last_7d / DAYS_IN_WEEK))}
                    </span>
                  </div>
                  {usage.last_used_at && (
                    <div className="flex justify-between">
                      <span>{t('apiKeys.usageDialog.daysSinceLastUse')}</span>
                      <span className="font-medium">
                        {Math.floor(
                          (Date.now() - new Date(usage.last_used_at).getTime()) / MS_PER_DAY
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="py-8 text-center text-gray-500">
            <p>{t('apiKeys.usageDialog.noUsageData')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
