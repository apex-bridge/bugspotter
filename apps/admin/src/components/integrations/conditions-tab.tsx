import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { FilterCondition } from '../../types';
import { RuleBuilder } from './rule-builder';

interface ConditionsTabProps {
  filters: FilterCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
}

export function ConditionsTab({ filters, onFiltersChange }: ConditionsTabProps) {
  const { t } = useTranslation();
  return (
    <div className="py-4">
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-1">
          {t('integrationConfig.conditionsTab.filterConditions')}
        </h3>
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('integrationConfig.conditionsTab.introBanner')}</span>
        </div>
      </div>
      <RuleBuilder filters={filters} onChange={onFiltersChange} />
    </div>
  );
}
