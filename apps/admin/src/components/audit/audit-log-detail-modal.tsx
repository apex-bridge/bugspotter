import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { formatDate, getActionBadgeColor } from '../../utils/audit-utils';
import type { AuditLog } from '../../types/audit';

interface AuditLogDetailModalProps {
  log: AuditLog;
  onClose: () => void;
}

export function AuditLogDetailModal({ log, onClose }: AuditLogDetailModalProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus management
  useEffect(() => {
    // Store previous focus
    previousFocusRef.current = document.activeElement as HTMLElement;
    // Focus modal
    modalRef.current?.focus();
    // Trap focus in modal
    document.body.style.overflow = 'hidden';

    return () => {
      // Restore previous focus and overflow
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, []);

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-log-modal-title"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>
                <span id="audit-log-modal-title">{t('auditLogs.auditLogDetails')}</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label={t('auditLogs.closeDetailsModal')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-500">{t('auditLogs.timestamp')}</p>
                <p className="text-sm">{formatDate(log.timestamp)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{t('auditLogs.action')}</p>
                <span
                  className={`inline-block px-2 py-1 rounded text-xs font-medium ${getActionBadgeColor(log.action)}`}
                >
                  {log.action}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{t('auditLogs.resource')}</p>
                <p className="text-sm font-mono">{log.resource}</p>
              </div>
              {log.resource_id && (
                <div>
                  <p className="text-sm font-medium text-gray-500">{t('auditLogs.resourceId')}</p>
                  <p className="text-sm font-mono">{log.resource_id}</p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-500">{t('auditLogs.userId')}</p>
                <p className="text-sm">{log.user_id || t('auditLogs.notAvailable')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{t('auditLogs.ipAddress')}</p>
                <p className="text-sm">{log.ip_address || t('auditLogs.notAvailable')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{t('auditLogs.userAgent')}</p>
                <p className="text-sm break-all">{log.user_agent || t('auditLogs.notAvailable')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{t('common.status')}</p>
                <div className="flex items-center gap-2">
                  {log.success ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-600" aria-hidden="true" />
                      <span className="text-sm text-green-600">{t('auditLogs.success')}</span>
                      <span className="sr-only">{t('auditLogs.success')}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-600" aria-hidden="true" />
                      <span className="text-sm text-red-600">{t('auditLogs.failed')}</span>
                      <span className="sr-only">{t('auditLogs.failed')}</span>
                    </>
                  )}
                </div>
              </div>
              {log.error_message && (
                <div>
                  <p className="text-sm font-medium text-gray-500">{t('auditLogs.errorMessage')}</p>
                  <p className="text-sm text-red-600">{log.error_message}</p>
                </div>
              )}
              {log.details && (
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-2">
                    {t('auditLogs.requestDetails')}
                  </p>
                  <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
