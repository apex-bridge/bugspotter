import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminService } from '../services/api';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { CheckCircle, XCircle } from 'lucide-react';
import { HealthHeader } from '../components/health/health-header';
import { HealthServices } from '../components/health/health-services';
import { HealthWorkers } from '../components/health/health-workers';
import { HealthQueues } from '../components/health/health-queues';
import { HealthPlugins } from '../components/health/health-plugins';
import { HealthMetrics } from '../components/health/health-metrics';
import { useState, useEffect, useRef, useCallback } from 'react';

// Type for translation function
type TFunction = (key: string, options?: Record<string, unknown>) => string;

// Memory usage thresholds (percentage)
const MEMORY_WARNING_THRESHOLD = 70;
const MEMORY_CRITICAL_THRESHOLD = 85;

// Processing time thresholds (milliseconds)
const SLOW_PROCESSING_THRESHOLD_MS = 1000;
const FAST_PROCESSING_THRESHOLD_MS = 500;

// Queue depth thresholds
const HIGH_QUEUE_WAITING_THRESHOLD = 100;
const HIGH_QUEUE_FAILED_THRESHOLD = 10;

// Translation key maps
const WORKER_NAMES_KEYS: Record<string, string> = {
  screenshot_worker: 'pages.workerNameScreenshot',
  replay_worker: 'pages.workerNameReplay',
  notification_worker: 'pages.workerNameNotification',
  integration_worker: 'pages.workerNameIntegration',
  retention_worker: 'pages.workerNameRetention',
};

const PLUGIN_PLATFORMS_KEYS: Record<string, string> = {
  jira: 'pages.pluginPlatformJira',
  slack: 'pages.pluginPlatformSlack',
  github: 'pages.pluginPlatformGithub',
  gitlab: 'pages.pluginPlatformGitlab',
  custom: 'pages.pluginPlatformCustom',
};

const QUEUE_NAMES_KEYS: Record<string, string> = {
  screenshots: 'pages.queueNameScreenshots',
  replays: 'pages.queueNameReplays',
  notifications: 'pages.queueNameNotifications',
  integrations: 'pages.queueNameIntegrations',
};

interface MemoryStatusInfo {
  color: string;
  status: string;
  textColor: string;
}

// Pure helper functions (defined outside component to avoid recreation on every render)
const getStatusColor = (status: string) => {
  switch (status) {
    case 'up':
    case 'healthy':
      return 'text-green-600';
    case 'degraded':
      return 'text-yellow-600';
    default:
      return 'text-red-600';
  }
};

const getStatusIcon = (status: string) => {
  if (status === 'up' || status === 'healthy') {
    return <CheckCircle className="w-6 h-6" aria-hidden="true" />;
  }
  return <XCircle className="w-6 h-6" aria-hidden="true" />;
};

const formatUptime = (seconds: number, t: (key: string) => string) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}${t('pages.uptimeFormatDays')} ${hours}${t('pages.uptimeFormatHours')} ${minutes}${t('pages.uptimeFormatMinutes')}`;
};

const getTimeAgo = (date: Date, t: TFunction) => {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) {
    return t('pages.justNow');
  }
  if (seconds < 60) {
    return t('pages.timeAgoSeconds', { count: seconds });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t('pages.timeAgoMinutes', { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  return t('pages.timeAgoHours', { count: hours });
};

const formatBytes = (bytes: number, t: (key: string) => string) => {
  if (bytes === 0) {
    return `0 ${t('pages.byteUnitB')}`;
  }
  const k = 1024;
  const sizeKeys = ['byteUnitB', 'byteUnitKB', 'byteUnitMB', 'byteUnitGB', 'byteUnitTB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${t(`pages.${sizeKeys[i]}`)}`;
};

const getWorkerDisplayName = (workerName: string, t: (key: string) => string) => {
  const key = WORKER_NAMES_KEYS[workerName];
  return key ? t(key) : workerName.replace(/_/g, ' ');
};

const getPluginDisplayName = (platform: string, t: (key: string) => string) => {
  const key = PLUGIN_PLATFORMS_KEYS[platform.toLowerCase()];
  return key ? t(key) : platform;
};

const getQueueDisplayName = (queueName: string, t: (key: string) => string) => {
  const key = QUEUE_NAMES_KEYS[queueName];
  return key ? t(key) : queueName;
};

const getMemoryStatusInfo = (percentage: number): MemoryStatusInfo => {
  if (percentage < MEMORY_WARNING_THRESHOLD) {
    return { color: 'bg-green-600', status: 'healthy', textColor: 'text-green-600' };
  }
  if (percentage < MEMORY_CRITICAL_THRESHOLD) {
    return { color: 'bg-yellow-500', status: 'warning', textColor: 'text-yellow-600' };
  }
  return { color: 'bg-red-600', status: 'critical', textColor: 'text-red-600' };
};

const getMemoryStatusLabel = (percentage: number, t: (key: string) => string): string => {
  const { status } = getMemoryStatusInfo(percentage);
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return t(`pages.memory${label}`);
};

export default function HealthPage() {
  const { t } = useTranslation();
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  const {
    data: health,
    isLoading,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['health'],
    queryFn: adminService.getHealth,
    refetchInterval: 10000, // Refresh every 10 seconds for near real-time monitoring
  });

  useEffect(() => {
    if (dataUpdatedAt) {
      setLastUpdated(new Date(dataUpdatedAt));
    }
  }, [dataUpdatedAt]);

  const exportHealthSnapshot = useCallback(() => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      status: health?.status,
      services: health?.services,
      workers: health?.workers,
      queues: health?.queues,
      system: health?.system,
      plugins: health?.plugins,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    if (downloadLinkRef.current) {
      downloadLinkRef.current.href = url;
      downloadLinkRef.current.download = `health-snapshot-${Date.now()}.json`;
      downloadLinkRef.current.click();

      // Clean up the object URL after a short delay
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  }, [health]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refetch(), new Promise((resolve) => setTimeout(resolve, 500))]);
    setIsRefreshing(false);
  }, [refetch]);

  // Calculate memory usage percentage for progress bar
  const memoryUsagePercentage = Math.min(
    ((health?.system?.process_memory_mb || 0) / (health?.system?.system_memory_mb || 1)) * 100,
    100
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div
          className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">{t('pages.loadingHealthData')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HealthHeader
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onExport={exportHealthSnapshot}
        getTimeAgo={getTimeAgo}
      />

      {/* Overall Status */}
      <Card
        className={`border-l-4 ${health?.status === 'healthy' ? 'border-l-green-500' : health?.status === 'degraded' ? 'border-l-yellow-500' : 'border-l-red-500'}`}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('pages.overallStatus')}</CardTitle>
              <CardDescription>
                {t('pages.systemIsStatus', { status: health?.status })}
              </CardDescription>
            </div>
            <div className={getStatusColor(health?.status || '')} role="status" aria-live="polite">
              <div className="relative">
                {getStatusIcon(health?.status || '')}
                {health?.status === 'healthy' && (
                  <span className="absolute inset-0 animate-ping opacity-75">
                    <CheckCircle className="w-6 h-6" aria-hidden="true" />
                  </span>
                )}
              </div>
              <span className="sr-only">
                System status: {health?.status || 'unknown'}
                {health?.status === 'healthy' && ' - All systems operational'}
              </span>
            </div>
          </div>
        </CardHeader>
      </Card>

      <HealthServices services={health?.services} getStatusColor={getStatusColor} />

      <HealthWorkers
        workers={health?.workers || []}
        getWorkerDisplayName={getWorkerDisplayName}
        slowThreshold={SLOW_PROCESSING_THRESHOLD_MS}
        fastThreshold={FAST_PROCESSING_THRESHOLD_MS}
      />

      {/* Queue Health */}
      <HealthQueues
        queues={health?.queues || []}
        getQueueDisplayName={getQueueDisplayName}
        waitingThreshold={HIGH_QUEUE_WAITING_THRESHOLD}
        failedThreshold={HIGH_QUEUE_FAILED_THRESHOLD}
      />

      {/* Plugin Registry */}
      <HealthPlugins plugins={health?.plugins || []} getPluginDisplayName={getPluginDisplayName} />

      {/* System Metrics */}
      <HealthMetrics
        system={health?.system}
        memoryUsagePercentage={memoryUsagePercentage}
        getMemoryStatusInfo={getMemoryStatusInfo}
        getMemoryStatusLabel={getMemoryStatusLabel}
        formatBytes={formatBytes}
        formatUptime={formatUptime}
        memoryWarningThreshold={MEMORY_WARNING_THRESHOLD}
        memoryCriticalThreshold={MEMORY_CRITICAL_THRESHOLD}
      />

      {/* Hidden anchor for accessible file downloads */}
      <a ref={downloadLinkRef} className="sr-only" aria-hidden="true" tabIndex={-1} />
    </div>
  );
}
