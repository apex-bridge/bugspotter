import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { analyticsService } from '../services/api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Activity, FolderKanban, Users, AlertCircle } from 'lucide-react';

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: () => analyticsService.getDashboard(),
    refetchInterval: 60000, // Refresh every minute
    retry: 1, // Only retry once
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">{t('pages.loadingDashboard')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="space-y-2">
          <div className="text-lg text-red-600">{t('pages.failedLoadDashboard')}</div>
          <div className="text-sm text-gray-500">
            {error instanceof Error ? error.message : t('pages.unknownError')}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-500">{t('pages.noData')}</div>
      </div>
    );
  }

  // Handle missing or incomplete data gracefully
  const bugReports = data.bug_reports?.by_status || {
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
    total: 0,
  };
  const bugPriority = data.bug_reports?.by_priority || {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const projects = data.projects || {
    total: 0,
    total_reports: 0,
    avg_reports_per_project: 0,
  };
  const users = data.users || { total: 0 };
  const timeSeries = data.time_series || [];
  const topProjects = data.top_projects || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('pages.analyticsDashboard')}</h1>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title={t('pages.totalBugReports')}
          value={bugReports.total}
          icon={<Activity className="w-6 h-6 text-blue-600" />}
          subtitle={`${bugReports.open} ${t('bugReports.statusOpen').toLowerCase()}`}
        />
        <MetricCard
          title={t('pages.projects')}
          value={projects.total}
          icon={<FolderKanban className="w-6 h-6 text-green-600" />}
          subtitle={`${projects.total_reports} ${t('pages.totalReports')}`}
        />
        <MetricCard
          title={t('pages.users')}
          value={users.total}
          icon={<Users className="w-6 h-6 text-purple-600" />}
        />
        <MetricCard
          title={t('pages.avgReportsPerProject')}
          value={projects.avg_reports_per_project.toFixed(1)}
          icon={<AlertCircle className="w-6 h-6 text-orange-600" />}
        />
      </div>

      {/* Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pages.reportsByStatus')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <StatusBar
              label={t('bugReports.statusOpen')}
              count={bugReports.open}
              total={bugReports.total}
              color="bg-blue-500"
            />
            <StatusBar
              label={t('bugReports.statusInProgress')}
              count={bugReports.in_progress}
              total={bugReports.total}
              color="bg-yellow-500"
            />
            <StatusBar
              label={t('bugReports.statusResolved')}
              count={bugReports.resolved}
              total={bugReports.total}
              color="bg-green-500"
            />
            <StatusBar
              label={t('bugReports.statusClosed')}
              count={bugReports.closed}
              total={bugReports.total}
              color="bg-gray-500"
            />
          </div>
        </CardContent>
      </Card>

      {/* Priority Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pages.reportsByPriority')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <StatusBar
              label={t('bugReports.priorityCritical')}
              count={bugPriority.critical}
              total={bugReports.total}
              color="bg-red-600"
            />
            <StatusBar
              label={t('bugReports.priorityHigh')}
              count={bugPriority.high}
              total={bugReports.total}
              color="bg-orange-500"
            />
            <StatusBar
              label={t('bugReports.priorityMedium')}
              count={bugPriority.medium}
              total={bugReports.total}
              color="bg-blue-500"
            />
            <StatusBar
              label={t('bugReports.priorityLow')}
              count={bugPriority.low}
              total={bugReports.total}
              color="bg-gray-500"
            />
          </div>
        </CardContent>
      </Card>

      {/* Top Projects */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pages.top5Projects')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topProjects.map((project) => {
              const percentage =
                projects.total_reports > 0
                  ? (project.report_count / projects.total_reports) * 100
                  : 0;
              return (
                <div key={project.id} className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-sm text-gray-600">
                      {project.report_count} {t('pages.reports')}
                    </div>
                  </div>
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{
                        width: `${percentage}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Time Series Chart (Simple) */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pages.reportTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-end space-x-1">
            {timeSeries.map((point) => {
              const maxCount = Math.max(...timeSeries.map((p) => p.count));
              const height = maxCount > 0 ? (point.count / maxCount) * 100 : 0;
              return (
                <div
                  key={point.date}
                  className="flex-1 bg-primary rounded-t hover:bg-primary/80 transition-colors"
                  style={{ height: `${height}%`, minHeight: point.count > 0 ? '4px' : '0' }}
                  title={`${point.date}: ${point.count} ${t('pages.reports')}`}
                />
              );
            })}
          </div>
          <div className="text-xs text-gray-500 text-center mt-2">
            {t('pages.showingDailyCounts')}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  subtitle,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600">{title}</div>
            <div className="text-3xl font-bold mt-1">{value}</div>
            {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
          </div>
          <div>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-medium">
          {count} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
