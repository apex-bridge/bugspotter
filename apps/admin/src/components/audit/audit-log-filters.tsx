import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Search } from 'lucide-react';

interface FilterInputs {
  action: string;
  resource: string;
  userId: string;
  success: string;
  startDate: string;
  endDate: string;
}

interface AuditLogFiltersProps {
  filterInputs: FilterInputs;
  onFilterChange: (field: keyof FilterInputs, value: string) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
}

export function AuditLogFilters({
  filterInputs,
  onFilterChange,
  onApplyFilters,
  onClearFilters,
}: AuditLogFiltersProps) {
  const { t } = useTranslation();

  return (
    <div id="audit-filters">
      <Card>
        <CardHeader>
          <CardTitle>{t('auditLogs.filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="filter-action" className="text-sm font-medium block mb-2">
                {t('auditLogs.action')}
              </label>
              <Select
                id="filter-action"
                value={filterInputs.action}
                onChange={(e) => onFilterChange('action', e.target.value)}
              >
                <option value="">{t('auditLogs.allActions')}</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </Select>
            </div>

            <div>
              <label htmlFor="filter-resource" className="text-sm font-medium block mb-2">
                {t('auditLogs.resource')}
              </label>
              <Input
                id="filter-resource"
                placeholder={t('auditLogs.resourcePlaceholder')}
                value={filterInputs.resource}
                onChange={(e) => onFilterChange('resource', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="filter-user-id" className="text-sm font-medium block mb-2">
                {t('auditLogs.userId')}
              </label>
              <Input
                id="filter-user-id"
                placeholder={t('auditLogs.enterUserId')}
                value={filterInputs.userId}
                onChange={(e) => onFilterChange('userId', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="filter-status" className="text-sm font-medium block mb-2">
                {t('common.status')}
              </label>
              <Select
                id="filter-status"
                value={filterInputs.success}
                onChange={(e) => onFilterChange('success', e.target.value)}
              >
                <option value="">{t('auditLogs.all')}</option>
                <option value="true">{t('auditLogs.success')}</option>
                <option value="false">{t('auditLogs.failed')}</option>
              </Select>
            </div>

            <div>
              <label htmlFor="filter-start-date" className="text-sm font-medium block mb-2">
                {t('auditLogs.startDate')}
              </label>
              <Input
                id="filter-start-date"
                type="datetime-local"
                value={filterInputs.startDate}
                onChange={(e) => onFilterChange('startDate', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="filter-end-date" className="text-sm font-medium block mb-2">
                {t('auditLogs.endDate')}
              </label>
              <Input
                id="filter-end-date"
                type="datetime-local"
                value={filterInputs.endDate}
                onChange={(e) => onFilterChange('endDate', e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button onClick={onApplyFilters}>
              <Search className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('auditLogs.applyFilters')}
            </Button>
            <Button variant="secondary" onClick={onClearFilters}>
              {t('auditLogs.clear')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export type { FilterInputs };
