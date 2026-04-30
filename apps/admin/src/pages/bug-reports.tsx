import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Bug, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { bugReportService, projectService } from '../services/api';
import { useAuth } from '../contexts/auth-context';
import { handleApiError } from '../lib/api-client';
import { Button } from '../components/ui/button';
import { BugReportFilters } from '../components/bug-reports/bug-report-filters';
import { SemanticSearchBar } from '../components/bug-reports/semantic-search-bar';
import { BugReportList } from '../components/bug-reports/bug-report-list';
import { BugReportDetail } from '../components/bug-reports/bug-report-detail';
import type { BugReportFilters as Filters, BugReport } from '../types';

export default function BugReportsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  // We hold just the id (not the whole BugReport) so the detail modal
  // can navigate to a different bug — e.g. clicking "View original" on
  // a duplicate badge — by swapping the id without remounting.
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const limit = 20;

  // Fetch projects for filter dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  // Fetch bug reports with filters and pagination
  const {
    data: reportData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['bugReports', filters, page, limit],
    queryFn: () => bugReportService.getAll(filters, page, limit),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: bugReportService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bugReports'] });
      toast.success(t('pages.deletedSuccessfully'));
    },
    onError: (apiError) => {
      toast.error(handleApiError(apiError));
    },
  });

  const handleFiltersChange = useCallback((newFilters: Filters) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  }, []);

  const handleNavigateToBug = useCallback((bugId: string) => {
    setSelectedReportId(bugId);
  }, []);

  const handleViewDetails = useCallback(
    (report: BugReport) => handleNavigateToBug(report.id),
    [handleNavigateToBug]
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedReportId(null);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation]
  );

  const handlePreviousPage = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    if (reportData?.pagination) {
      setPage((prev) => Math.min(reportData.pagination.totalPages, prev + 1));
    }
  }, [reportData]);

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t('bugReports.title')}</h1>
            <p className="text-gray-500 mt-1">{t('bugReports.viewManageReports')}</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-semibold">{t('bugReports.errorLoading')}</p>
          <p className="text-sm mt-1">{handleApiError(error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bug className="w-8 h-8" />
            {t('pages.bugReportsPage')}
          </h1>
          <p className="text-gray-500 mt-1">{t('pages.manageBugReports')}</p>
        </div>
        {reportData?.pagination && (
          <div className="text-sm text-gray-600">
            {t('bugReports.showingReports', {
              from: formatNumber((page - 1) * limit + 1),
              to: formatNumber(Math.min(page * limit, reportData.pagination.total)),
              total: formatNumber(reportData.pagination.total),
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <BugReportFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        projects={projects}
      />

      {/* AI Semantic Search */}
      {filters.project_id && (
        <SemanticSearchBar
          projectId={filters.project_id}
          onResultSelect={(bugId) => {
            const matched = reportData?.data.find((r) => r.id === bugId);
            if (matched) {
              handleViewDetails(matched);
            } else {
              bugReportService
                .getById(bugId)
                .then((report) => handleViewDetails(report))
                .catch((err) => {
                  console.error('Failed to fetch bug report:', err);
                  toast.error(t('bugReports.errorLoading'));
                });
            }
          }}
        />
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      )}

      {/* Bug Reports List */}
      {!isLoading && reportData && (
        <>
          {reportData.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <Bug className="w-16 h-16 text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                {t('pages.no.reportsFound')}
              </h3>
              <p className="text-gray-500 text-center max-w-md mb-6">
                {Object.keys(filters).length > 0
                  ? t('bugReports.noMatchFilters')
                  : t('bugReports.startCapturing')}
              </p>
              {Object.keys(filters).length > 0 && (
                <Button variant="secondary" onClick={() => handleFiltersChange({})}>
                  {t('bugReports.clearFilters')}
                </Button>
              )}
            </div>
          ) : (
            <>
              <BugReportList
                reports={reportData.data}
                projects={projects}
                onViewDetails={handleViewDetails}
                onDelete={handleDelete}
                isDeleting={deleteMutation.isPending}
                readOnly={isViewer}
              />

              {/* Pagination */}
              {reportData.pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-4">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handlePreviousPage}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    {t('bugReports.previous')}
                  </Button>
                  <span className="text-sm text-gray-600">
                    {t('bugReports.pageOf', { page, totalPages: reportData.pagination.totalPages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleNextPage}
                    disabled={page === reportData.pagination.totalPages}
                  >
                    {t('bugReports.next')}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedReportId && (
        // `key` forces a remount when navigating between bugs (e.g.
        // duplicate → original). Without it React would reuse the
        // same instance, leaking internal state — active tab,
        // download flags, scroll position — across different bugs.
        <BugReportDetail
          key={selectedReportId}
          reportId={selectedReportId}
          onClose={handleCloseDetail}
          onNavigateToBug={handleNavigateToBug}
        />
      )}
    </div>
  );
}
