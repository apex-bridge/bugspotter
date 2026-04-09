import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Pause, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

interface WorkerHealth {
  name: string;
  running: boolean;
  enabled: boolean;
  jobs_processed: number;
  jobs_failed: number;
  avg_processing_time_ms?: number;
  last_error?: string;
}

interface HealthWorkersProps {
  workers: WorkerHealth[];
  getWorkerDisplayName: (name: string, t: (key: string) => string) => string;
  slowThreshold: number;
  fastThreshold: number;
}

// Helper function to render processing time indicator
const renderProcessingTimeIndicator = (
  processingTime: number | undefined,
  slowThreshold: number,
  fastThreshold: number
) => {
  if (!processingTime) {
    return null;
  }

  if (processingTime > slowThreshold) {
    return (
      <>
        <TrendingUp className="w-3 h-3 text-orange-500" aria-hidden="true" />
        <span className="sr-only">Processing time slow</span>
      </>
    );
  }

  if (processingTime < fastThreshold) {
    return (
      <>
        <TrendingDown className="w-3 h-3 text-green-500" aria-hidden="true" />
        <span className="sr-only">Processing time fast</span>
      </>
    );
  }

  return null;
};

export const HealthWorkers: React.FC<HealthWorkersProps> = ({
  workers,
  getWorkerDisplayName,
  slowThreshold,
  fastThreshold,
}) => {
  const { t } = useTranslation();

  if (!workers || workers.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('pages.backgroundWorkers')}</h2>
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-500" aria-hidden="true" />
            <p>{t('pages.noWorkersDetected')}</p>
            <p className="text-xs mt-1">{t('pages.workersNotEnabled')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.backgroundWorkers')}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {workers.map((worker) => (
          <Card key={worker.name}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {getWorkerDisplayName(worker.name, t)}
                </CardTitle>
                {worker.running ? (
                  <>
                    <Activity className="h-4 w-4 text-green-600" aria-hidden="true" />
                    <span className="sr-only">{t('pages.workerRunning')}</span>
                  </>
                ) : worker.enabled ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
                    <span className="sr-only">{t('pages.workerStopped')}</span>
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    <span className="sr-only">{t('pages.workerDisabled')}</span>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{t('pages.status')}</span>
                <Badge variant={worker.running ? 'default' : 'destructive'} className="text-xs">
                  {worker.running ? t('pages.running') : t('pages.stopped')}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{t('pages.processed')}</span>
                <span className="font-mono font-medium">{worker.jobs_processed}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{t('pages.failed')}</span>
                <span
                  className={`font-mono font-medium ${worker.jobs_failed > 0 ? 'text-red-600' : ''}`}
                >
                  {worker.jobs_failed}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{t('pages.avgTime')}</span>
                <span className="font-mono font-medium flex items-center gap-1">
                  {(worker.avg_processing_time_ms || 0).toFixed(0)}ms
                  {renderProcessingTimeIndicator(
                    worker.avg_processing_time_ms,
                    slowThreshold,
                    fastThreshold
                  )}
                </span>
              </div>
              {worker.last_error && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-red-600 line-clamp-2" title={worker.last_error}>
                    {worker.last_error}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default HealthWorkers;
