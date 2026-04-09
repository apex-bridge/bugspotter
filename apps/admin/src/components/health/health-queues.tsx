import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Layers, Pause } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  delayed: number;
  paused?: boolean;
}

interface HealthQueuesProps {
  queues: QueueHealth[];
  getQueueDisplayName: (name: string, t: (key: string) => string) => string;
  waitingThreshold: number;
  failedThreshold: number;
}

export const HealthQueues: React.FC<HealthQueuesProps> = ({
  queues,
  getQueueDisplayName,
  waitingThreshold,
  failedThreshold,
}) => {
  const { t } = useTranslation();

  if (!queues || queues.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('pages.jobQueues')}</h2>
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            <Layers className="h-8 w-8 mx-auto mb-2 text-gray-400" aria-hidden="true" />
            <p>{t('pages.noQueuesDetected')}</p>
            <p className="text-xs mt-1">{t('pages.queueNotInitialized')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.jobQueues')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {queues.map((queue) => (
          <Card key={queue.name}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {getQueueDisplayName(queue.name, t)}
                </CardTitle>
                <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500">{t('pages.waiting')}</p>
                  <p className="text-lg font-semibold flex items-center gap-1">
                    {queue.waiting}
                    {queue.waiting > waitingThreshold && (
                      <>
                        <AlertTriangle className="w-4 h-4 text-yellow-500" aria-hidden="true" />
                        <span className="sr-only">{t('pages.highQueueWarning')}</span>
                      </>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('pages.active')}</p>
                  <p
                    className="text-lg font-semibold text-blue-600 flex items-center gap-1"
                    role="status"
                    aria-live="polite"
                  >
                    {queue.active}
                    {queue.active > 0 && (
                      <>
                        <Activity className="w-4 h-4 animate-pulse" aria-hidden="true" />
                        <span className="sr-only">{t('pages.processingJobs')}</span>
                      </>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('pages.failed')}</p>
                  <p
                    className={`text-lg font-semibold flex items-center gap-1 ${queue.failed > 0 ? 'text-red-600' : ''}`}
                  >
                    {queue.failed}
                    {queue.failed > failedThreshold && (
                      <>
                        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                        <span className="sr-only">{t('pages.manyFailedJobs')}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t">
                <div>
                  <p className="text-xs text-gray-500">{t('pages.completed')}</p>
                  <p className="text-sm font-mono">{queue.completed.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('pages.delayed')}</p>
                  <p className="text-sm font-mono">{queue.delayed}</p>
                </div>
              </div>
              {queue.paused && (
                <div className="mt-3 pt-3 border-t">
                  <Badge variant="secondary" className="text-xs">
                    <Pause className="w-3 h-3 mr-1" aria-hidden="true" />
                    {t('pages.paused')}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default HealthQueues;
