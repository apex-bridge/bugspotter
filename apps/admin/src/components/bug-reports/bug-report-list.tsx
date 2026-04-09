import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Eye, Trash2 } from 'lucide-react';
import { formatDate } from '../../utils/format';
import { statusConfig, priorityConfig } from '../../utils/bug-report-styles';
import type { BugReport, Project } from '../../types';

interface BugReportListProps {
  reports: BugReport[];
  projects: Project[];
  onViewDetails: (report: BugReport) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
  readOnly?: boolean;
}

export function BugReportList({
  reports,
  projects,
  onViewDetails,
  onDelete,
  isDeleting,
  readOnly,
}: BugReportListProps) {
  const { t } = useTranslation();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const getProjectName = useCallback(
    (projectId: string) => {
      return projects.find((p) => p.id === projectId)?.name || 'Unknown';
    },
    [projects]
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (deleteConfirm === id) {
        onDelete(id);
        setDeleteConfirm(null);
      } else {
        setDeleteConfirm(id);
        setTimeout(() => setDeleteConfirm(null), 3000);
      }
    },
    [deleteConfirm, onDelete]
  );

  return (
    <div className="space-y-3" data-testid="bug-report-list">
      {reports.map((report) => {
        // Normalize status key (convert dashes to underscores)
        const statusKey = report.status.replace('-', '_') as keyof typeof statusConfig;
        const StatusIcon = statusConfig[statusKey].icon;
        const statusStyle = statusConfig[statusKey];
        const priorityStyle = priorityConfig[report.priority];

        return (
          <Card
            key={report.id}
            className="hover:shadow-md transition-shadow"
            data-testid="bug-report-card"
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                {/* Main Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold truncate">{report.title}</h3>
                    {report.legal_hold && (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                        {t('bugReports.legalHold')}
                      </span>
                    )}
                  </div>

                  {report.description && (
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">{report.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {/* Project */}
                    <span className="text-gray-600">
                      {t('bugReports.projectLabel')}{' '}
                      <span className="font-medium">{getProjectName(report.project_id)}</span>
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusStyle.color}`}
                    >
                      <StatusIcon className="w-3 h-3" />
                      {statusStyle.label}
                    </span>

                    {/* Priority Badge */}
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${priorityStyle.color}`}
                    >
                      {priorityStyle.label}
                    </span>

                    {/* Date */}
                    <span className="text-gray-500 text-xs">{formatDate(report.created_at)}</span>

                    {/* Screenshots */}
                    {report.screenshot_url && (
                      <span className="inline-flex items-center text-xs text-gray-500">
                        📸 {t('bugReports.screenshot')}
                      </span>
                    )}

                    {/* Session Replay */}
                    {report.replay_url && (
                      <span className="inline-flex items-center text-xs text-gray-500">
                        🎬 {t('bugReports.replay')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => onViewDetails(report)}>
                    <Eye className="w-4 h-4 mr-1" />
                    {t('bugReports.view')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(report.id)}
                    isLoading={isDeleting && deleteConfirm === report.id}
                    disabled={report.legal_hold || readOnly}
                    title={report.legal_hold ? t('bugReports.cannotDeleteLegalHold') : ''}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {deleteConfirm === report.id
                      ? t('bugReports.confirmDelete')
                      : t('bugReports.delete')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
