import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Button } from '../ui/button';
import { Filter, X } from 'lucide-react';
import type { BugReportFilters, BugStatus, BugPriority, Project } from '../../types';

interface BugReportFiltersProps {
  filters: BugReportFilters;
  onFiltersChange: (filters: BugReportFilters) => void;
  projects: Project[];
}

export function BugReportFilters({ filters, onFiltersChange, projects }: BugReportFiltersProps) {
  const { t } = useTranslation();

  const statusOptions = useMemo<{ value: BugStatus; label: string }[]>(
    () => [
      { value: 'open', label: t('bugReports.statusOpen') },
      { value: 'in-progress', label: t('bugReports.statusInProgress') },
      { value: 'resolved', label: t('bugReports.statusResolved') },
      { value: 'closed', label: t('bugReports.statusClosed') },
    ],
    [t]
  );

  const priorityOptions = useMemo<{ value: BugPriority; label: string; color: string }[]>(
    () => [
      { value: 'low', label: t('bugReports.priorityLow'), color: 'text-gray-600' },
      { value: 'medium', label: t('bugReports.priorityMedium'), color: 'text-blue-600' },
      { value: 'high', label: t('bugReports.priorityHigh'), color: 'text-orange-600' },
      { value: 'critical', label: t('bugReports.priorityCritical'), color: 'text-red-600' },
    ],
    [t]
  );

  const updateFilter = useCallback(
    <K extends keyof BugReportFilters>(key: K, value: BugReportFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const clearFilters = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const hasActiveFilters = Object.keys(filters).length > 0;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-gray-500" />
          <h3 className="font-semibold">{t('bugReports.filters')}</h3>
          {hasActiveFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="ml-auto">
              <X className="w-3 h-3 mr-1" />
              {t('bugReports.clearAll')}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Project Filter */}
          <Select
            label={t('bugReports.project')}
            id="filter-project"
            value={filters.project_id || ''}
            onChange={(e) => updateFilter('project_id', e.target.value || undefined)}
          >
            <option value="">{t('bugReports.allProjects')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>

          {/* Status Filter */}
          <Select
            label={t('bugReports.status')}
            id="filter-status"
            value={filters.status || ''}
            onChange={(e) => updateFilter('status', (e.target.value as BugStatus) || undefined)}
          >
            <option value="">{t('bugReports.allStatuses')}</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          {/* Priority Filter */}
          <Select
            label={t('bugReports.priority')}
            id="filter-priority"
            value={filters.priority || ''}
            onChange={(e) => updateFilter('priority', (e.target.value as BugPriority) || undefined)}
          >
            <option value="">{t('bugReports.allPriorities')}</option>
            {priorityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          {/* Date From Filter */}
          <Input
            label={t('bugReports.fromDate')}
            id="filter-from-date"
            type="date"
            value={filters.created_after || ''}
            onChange={(e) => updateFilter('created_after', e.target.value || undefined)}
          />

          {/* Date To Filter */}
          <Input
            label={t('bugReports.toDate')}
            id="filter-to-date"
            type="date"
            value={filters.created_before || ''}
            onChange={(e) => updateFilter('created_before', e.target.value || undefined)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
