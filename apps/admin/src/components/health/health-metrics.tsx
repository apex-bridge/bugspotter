import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Cpu, HardDrive, Layers, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface SystemHealth {
  process_memory_mb?: number;
  system_memory_mb?: number;
  disk_space_available?: number;
  disk_space_total?: number;
  worker_queue_depth?: number;
  uptime?: number;
  node_version?: string;
}

interface MemoryStatusInfo {
  color: string;
  status: string;
  textColor: string;
}

interface HealthMetricsProps {
  system?: SystemHealth;
  memoryUsagePercentage: number;
  getMemoryStatusInfo: (percentage: number) => MemoryStatusInfo;
  getMemoryStatusLabel: (percentage: number, t: (key: string) => string) => string;
  formatBytes: (bytes: number, t: (key: string) => string) => string;
  formatUptime: (seconds: number, t: (key: string) => string) => string;
  memoryWarningThreshold: number;
  memoryCriticalThreshold: number;
}

export const HealthMetrics: React.FC<HealthMetricsProps> = ({
  system,
  memoryUsagePercentage,
  getMemoryStatusInfo,
  getMemoryStatusLabel,
  formatBytes,
  formatUptime,
  memoryWarningThreshold,
  memoryCriticalThreshold,
}) => {
  const { t } = useTranslation();
  const memoryInfo = getMemoryStatusInfo(memoryUsagePercentage);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.systemMetrics')}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Process Memory */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('pages.processMemory')}</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{system?.process_memory_mb || 0} MB</div>
            <p className="text-xs text-muted-foreground">
              {t('pages.systemTotal', {
                total: system?.system_memory_mb || 0,
                percent: Math.round(memoryUsagePercentage),
              })}
            </p>
            <div className="mt-2 w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${memoryInfo.color}`}
                style={{ width: `${memoryUsagePercentage}%` }}
                role="progressbar"
                aria-valuenow={system?.process_memory_mb || 0}
                aria-valuemin={0}
                aria-valuemax={system?.system_memory_mb || 0}
                aria-label={`Process memory usage: ${system?.process_memory_mb || 0} MB of ${system?.system_memory_mb || 0} MB system memory (${Math.round(memoryUsagePercentage)}%)`}
              />
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className={`text-xs font-medium ${memoryInfo.textColor}`}>
                {getMemoryStatusLabel(memoryUsagePercentage, t)}
              </span>
              {memoryUsagePercentage >= memoryWarningThreshold && (
                <>
                  <TrendingUp className="w-4 h-4 text-orange-500" aria-hidden="true" />
                  <span className="sr-only">
                    {memoryUsagePercentage >= memoryCriticalThreshold
                      ? t('pages.memoryCriticallyHigh')
                      : t('pages.memoryElevated')}
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Disk Space */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('pages.diskSpace')}</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatBytes(
                (system?.disk_space_total || 0) - (system?.disk_space_available || 0),
                t
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('pages.diskAvailable', {
                total: formatBytes(system?.disk_space_total || 0, t),
              })}
            </p>
          </CardContent>
        </Card>

        {/* Queue Depth */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('pages.queueDepth')}</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{system?.worker_queue_depth || 0}</div>
            <p className="text-xs text-muted-foreground">{t('pages.pendingJobs')}</p>
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('pages.uptime')}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(system?.uptime || 0, t)}</div>
            <p className="text-xs text-muted-foreground">Node.js {system?.node_version}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default HealthMetrics;
