import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Shield, TrendingDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { projectService } from '../../services/api';
import { intelligenceService } from '../../services/intelligence-service';
import type { DeflectionStats } from '../../types/intelligence';

interface DeflectionStatsCardProps {
  orgId: string;
}

export function DeflectionStatsCard({ orgId }: DeflectionStatsCardProps) {
  const { t } = useTranslation();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Reset project selection when org changes
  useEffect(() => {
    setSelectedProjectId('');
  }, [orgId]);

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', orgId],
    queryFn: projectService.getAll,
    enabled: !!orgId,
  });

  const projects = allProjects.filter((p) => p.organization_id === orgId);

  const {
    data: stats,
    isFetching,
    isError,
  } = useQuery({
    queryKey: ['deflection-stats', selectedProjectId],
    queryFn: () => intelligenceService.getDeflectionStats(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-600" aria-hidden="true" />
            <CardTitle>{t('intelligence.deflection.title')}</CardTitle>
          </div>
          <select
            aria-label={t('intelligence.deflection.selectProject')}
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">{t('intelligence.deflection.selectProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <DeflectionContent
          selectedProjectId={selectedProjectId}
          stats={stats}
          isFetching={isFetching}
          isError={isError}
          t={t}
        />
      </CardContent>
    </Card>
  );
}

function DeflectionContent({
  selectedProjectId,
  stats,
  isFetching,
  isError,
  t,
}: {
  selectedProjectId: string;
  stats: DeflectionStats | undefined;
  isFetching: boolean;
  isError: boolean;
  t: TFunction;
}) {
  if (!selectedProjectId) {
    return (
      <p className="text-sm text-gray-500 text-center py-4">
        {t('intelligence.deflection.selectProject')}
      </p>
    );
  }

  if (isFetching) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600 text-center py-4">
        {t('intelligence.errors.intelligenceUnavailable')}
      </p>
    );
  }

  if (!stats || stats.total_deflections === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-4">
        {t('intelligence.deflection.noData')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-700">{stats.total_deflections}</div>
          <div className="text-xs text-gray-500">{t('intelligence.deflection.total')}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-700">{stats.deflections_last_7d}</div>
          <div className="text-xs text-gray-500">{t('intelligence.deflection.last7Days')}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-700">{stats.deflections_last_30d}</div>
          <div className="text-xs text-gray-500">{t('intelligence.deflection.last30Days')}</div>
        </div>
      </div>

      {stats.top_matched_bugs.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
            <TrendingDown className="w-4 h-4" aria-hidden="true" />
            {t('intelligence.deflection.topMatched')}
          </h4>
          <div className="space-y-2">
            {stats.top_matched_bugs.map((bug) => (
              <div
                key={bug.bug_id}
                className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2"
              >
                <code className="text-xs font-mono text-gray-600">{bug.bug_id.slice(0, 8)}</code>
                <Badge variant="secondary">
                  {t('intelligence.deflection.matchCount', {
                    count: bug.deflection_count,
                  })}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
