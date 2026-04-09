import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auditLogService } from '../services/audit-logs';
import { handleApiError } from '../lib/api-client';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Filter, ChevronLeft, ChevronRight, CheckCircle, XCircle, Eye } from 'lucide-react';
import { formatDate, getActionBadgeColor } from '../utils/audit-utils';
import { formatNumber } from '../utils/format';
import { StatisticsCards } from '../components/audit/statistics-cards';
import { AuditLogFilters } from '../components/audit/audit-log-filters';
import { AuditLogDetailModal } from '../components/audit/audit-log-detail-modal';
import type { AuditLog, AuditLogFilters as AuditLogFiltersType } from '../types/audit';
import type { FilterInputs } from '../components/audit/audit-log-filters';

export default function AuditLogsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [filters, setFilters] = useState<AuditLogFiltersType>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Consolidated filter inputs
  const [filterInputs, setFilterInputs] = useState<FilterInputs>({
    action: '',
    resource: '',
    userId: '',
    success: '',
    startDate: '',
    endDate: '',
  });

  const {
    data,
    isLoading,
    error: logsError,
  } = useQuery({
    queryKey: ['audit-logs', page, filters],
    queryFn: () => auditLogService.getAuditLogs(filters, 'timestamp', 'desc', page, limit),
  });

  const { data: stats, error: statsError } = useQuery({
    queryKey: ['audit-statistics'],
    queryFn: () => auditLogService.getStatistics(),
  });

  // Update filter input handler
  const handleFilterChange = useCallback((field: keyof FilterInputs, value: string) => {
    setFilterInputs((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Apply filters with proper memoization
  const applyFilters = useCallback(() => {
    const newFilters: AuditLogFiltersType = {};

    // Map filter inputs to API filter fields
    const fieldMapping: Array<{
      input: keyof FilterInputs;
      output: keyof AuditLogFiltersType;
      transform?: (value: string) => string | boolean;
    }> = [
      { input: 'action', output: 'action' },
      { input: 'resource', output: 'resource' },
      { input: 'userId', output: 'user_id' },
      { input: 'success', output: 'success', transform: (v) => v === 'true' },
      { input: 'startDate', output: 'start_date' },
      { input: 'endDate', output: 'end_date' },
    ];

    // Apply non-empty filters with transformations
    fieldMapping.forEach(({ input, output, transform }) => {
      const value = filterInputs[input];
      if (value) {
        (newFilters as Record<string, string | boolean>)[output] = transform
          ? transform(value)
          : value;
      }
    });

    setFilters(newFilters);
    setPage(1);
  }, [filterInputs]);

  // Clear filters with proper memoization
  const clearFilters = useCallback(() => {
    setFilterInputs({
      action: '',
      resource: '',
      userId: '',
      success: '',
      startDate: '',
      endDate: '',
    });
    setFilters({});
    setPage(1);
  }, []);

  // Show error state if logs fail to load
  if (logsError) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">{t('auditLogs.title')}</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-semibold">{t('auditLogs.errorLoadingLogs')}</p>
          <p className="text-sm mt-1">{handleApiError(logsError)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{t('auditLogs.title')}</h1>
        <Button
          variant="secondary"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          aria-controls="audit-filters"
        >
          <Filter className="w-4 h-4 mr-2" aria-hidden="true" />
          {showFilters ? t('auditLogs.hideFilters') : t('auditLogs.showFilters')}
        </Button>
      </div>

      {/* Statistics Cards */}
      {stats && !statsError && stats.data && <StatisticsCards statistics={stats.data} />}

      {/* Filters */}
      {showFilters && (
        <AuditLogFilters
          filterInputs={filterInputs}
          onFilterChange={handleFilterChange}
          onApplyFilters={applyFilters}
          onClearFilters={clearFilters}
        />
      )}

      {/* Audit Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('auditLogs.auditTrail')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8" role="status" aria-live="polite">
              {t('auditLogs.loadingLogs')}
            </div>
          ) : data?.data.length === 0 ? (
            <div className="text-center py-8 text-gray-500" role="status">
              {t('auditLogs.noLogs')}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">
                    Audit log entries with timestamp, action, resource, user, status, IP address,
                    and details
                  </caption>
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 font-medium">{t('auditLogs.timestamp')}</th>
                      <th className="text-left p-3 font-medium">{t('auditLogs.action')}</th>
                      <th className="text-left p-3 font-medium">{t('auditLogs.resource')}</th>
                      <th className="text-left p-3 font-medium">{t('auditLogs.user')}</th>
                      <th className="text-left p-3 font-medium">{t('common.status')}</th>
                      <th className="text-left p-3 font-medium">{t('auditLogs.ipAddress')}</th>
                      <th className="text-right p-3 font-medium">{t('auditLogs.details')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.data.map((log) => (
                      <tr key={log.id} className="border-b hover:bg-gray-50">
                        <td className="p-3 text-sm">{formatDate(log.timestamp)}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${getActionBadgeColor(log.action)}`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 text-sm font-mono">{log.resource}</td>
                        <td className="p-3 text-sm">
                          {log.user_id || t('auditLogs.notAvailable')}
                        </td>
                        <td className="p-3">
                          {log.success ? (
                            <>
                              <CheckCircle className="w-5 h-5 text-green-600" aria-hidden="true" />
                              <span className="sr-only">{t('auditLogs.success')}</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-5 h-5 text-red-600" aria-hidden="true" />
                              <span className="sr-only">{t('auditLogs.failed')}</span>
                            </>
                          )}
                        </td>
                        <td className="p-3 text-sm">
                          {log.ip_address || t('auditLogs.notAvailable')}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedLog(log)}
                            aria-label={t('auditLogs.viewDetails', {
                              action: log.action,
                              resource: log.resource,
                              timestamp: formatDate(log.timestamp),
                            })}
                          >
                            <Eye className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-gray-500">
                    {t('auditLogs.pageInfo', {
                      page: data.pagination.page,
                      totalPages: data.pagination.totalPages,
                      total: formatNumber(data.pagination.total),
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                      {t('auditLogs.previous')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page >= data.pagination.totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      {t('auditLogs.next')}
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedLog && (
        <AuditLogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
}
