import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { X, Image as ImageIcon, Download, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { bugReportService, storageService } from '../../services/api';
import { formatDate } from '../../utils/format';
import { SessionReplayPlayer } from './session-replay-player';
import { BugReportStatusControls } from './bug-report-status-controls';
import { BugReportBrowserMetadata } from './bug-report-browser-metadata';
import { BugReportNetworkTable } from './bug-report-network-table';
import { BugReportConsoleLogs } from './bug-report-console-logs';
import { ShareTokenManager } from './share-token-manager';
import { DuplicateBadge } from './duplicate-badge';
import { AIEnrichmentCard } from './ai-enrichment-card';
import { SimilarBugsWidget } from './similar-bugs-widget';
import { SuggestFixButton } from './suggest-fix-button';
import { IntelligenceDisabledNotice } from './intelligence-disabled-notice';
import { useIntelligenceStatus } from '../../hooks/use-intelligence-status';
import { toast } from 'sonner';

interface BugReportDetailProps {
  reportId: string;
  onClose: () => void;
}

export function BugReportDetail({ reportId, onClose }: BugReportDetailProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'replay' | 'details' | 'logs'>('replay');
  const [isDownloading, setIsDownloading] = useState(false);
  const { isEnabled: intelligenceEnabled } = useIntelligenceStatus();

  const { data: report, isLoading } = useQuery({
    queryKey: ['bugReport', reportId],
    queryFn: () => bugReportService.getById(reportId),
  });

  const handleDownloadScreenshot = async () => {
    if (!report) {
      return;
    }

    try {
      setIsDownloading(true);
      await storageService.downloadResource(
        report.id,
        'screenshot',
        `screenshot-${report.title.replace(/[^a-z0-9]/gi, '-')}.png`
      );
      toast.success(t('bugReports.downloadStarted'));
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to download screenshot:', error);
      }
      toast.error(t('errors.failedToDownloadScreenshot'));
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading || !report) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div
          className="bg-white rounded-lg p-8 max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('bugReports.loadingDetails')}
        >
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </div>
      </div>
    );
  }

  const hasReplay = !!report.replay_key && report.replay_upload_status === 'completed';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b">
          <div className="flex-1">
            <h2 id="bug-report-title" className="text-2xl font-bold mb-2">
              {report.title}
            </h2>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span>Created: {formatDate(report.created_at)}</span>
              {report.updated_at !== report.created_at && (
                <span>• Updated: {formatDate(report.updated_at)}</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t('bugReports.closeModal')}
            data-testid="close-modal"
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </Button>
        </div>

        {/* External Ticket Link */}
        {typeof report.metadata?.externalId === 'string' &&
          typeof report.metadata?.externalUrl === 'string' && (
            <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-blue-900">
                  {t('bugReports.linkedIssue')}
                </span>
                <a
                  href={report.metadata.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 hover:underline"
                  aria-label={t('bugReports.openLinkedIssue', {
                    externalId: report.metadata.externalId,
                  })}
                >
                  {report.metadata.externalId}
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          )}

        {/* Duplicate Badge */}
        {report.duplicate_of && (
          <DuplicateBadge
            duplicateOf={report.duplicate_of}
            bugReportId={report.id}
            projectId={report.project_id}
          />
        )}

        {/* Status and Priority Controls */}
        <BugReportStatusControls report={report} />

        {/* Tabs */}
        <div className="border-b">
          <div className="flex px-6">
            <button
              onClick={() => setActiveTab('replay')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'replay'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('bugReports.sessionReplay')}
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('bugReports.detailsMetadata')}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'logs'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('bugReports.consoleLogs')}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'replay' && (
            <div className="space-y-6">
              {hasReplay ? (
                <SessionReplayPlayer
                  bugReportId={report.id}
                  hasReplay={hasReplay}
                  viewport={report.metadata.metadata?.viewport}
                />
              ) : (
                <div className="flex items-center justify-center h-[600px] bg-gray-100 rounded-lg">
                  <div className="text-center text-gray-500">
                    <p className="mb-2">📹 {t('bugReports.noSessionReplay')}</p>
                    <p className="text-sm">{t('bugReports.noSessionReplayDescription')}</p>
                  </div>
                </div>
              )}

              {/* Public Share Token Manager */}
              <ShareTokenManager bugReportId={report.id} hasReplay={hasReplay} />
            </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* AI Enrichment / similar / suggest-fix — gated on per-org
                  intelligence_enabled. When disabled, render a single
                  notice instead of three broken affordances. */}
              {intelligenceEnabled === false ? (
                <IntelligenceDisabledNotice />
              ) : (
                <>
                  <AIEnrichmentCard bugReportId={report.id} />
                  <SimilarBugsWidget bugReportId={report.id} projectId={report.project_id} />
                  <SuggestFixButton bugReportId={report.id} projectId={report.project_id} />
                </>
              )}

              {/* Description */}
              {report.description && (
                <div>
                  <h3 className="text-lg font-semibold mb-2">{t('bugReports.description')}</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{report.description}</p>
                </div>
              )}

              {/* Screenshot */}
              {report.screenshot_url && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <ImageIcon className="w-5 h-5" aria-hidden="true" />
                      {t('bugReports.screenshot')}
                    </h3>
                    {report.screenshot_key && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleDownloadScreenshot}
                        isLoading={isDownloading}
                        disabled={isDownloading}
                      >
                        <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                        {t('bugReports.download')}
                      </Button>
                    )}
                  </div>
                  <img
                    src={report.screenshot_url}
                    alt={t('bugReports.bugScreenshot')}
                    className="max-w-full rounded-lg border shadow-sm"
                  />
                </div>
              )}

              {/* Browser Metadata */}
              {report.metadata?.metadata && (
                <BugReportBrowserMetadata metadata={report.metadata.metadata} />
              )}

              {/* Network Requests */}
              {report.metadata?.network && (
                <BugReportNetworkTable requests={report.metadata.network} />
              )}
            </div>
          )}

          {activeTab === 'logs' && <BugReportConsoleLogs logs={report.metadata?.console || []} />}
        </div>
      </div>
    </div>
  );
}
