import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Plus, Trash2 } from 'lucide-react';
import type { FilterCondition } from '../../types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import { Checkbox } from '../ui/checkbox';

interface RuleBuilderProps {
  filters: FilterCondition[];
  onChange: (filters: FilterCondition[]) => void;
}

interface FilterWithId extends FilterCondition {
  _id: string;
}

const FIELD_OPTIONS = [
  { value: 'priority', label: 'Bug Priority (optional field)' },
  { value: 'status', label: 'Status' },
  { value: 'browser', label: 'Browser' },
  { value: 'os', label: 'Operating System' },
  { value: 'url_pattern', label: 'URL Pattern' },
  { value: 'user_email', label: 'User Email' },
  { value: 'error_message', label: 'Error Message' },
  { value: 'project', label: 'Project' },
  { value: 'console_level', label: 'Console Log Level' },
  { value: 'console_message', label: 'Console Log Message' },
  { value: 'network_status', label: 'Network Status Code' },
  { value: 'network_url', label: 'Network URL' },
] as const;

const OPERATOR_OPTIONS = [
  { value: 'equals', label: 'Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'regex', label: 'Regular Expression' },
  { value: 'in', label: 'In (comma-separated)' },
  { value: 'not_in', label: 'Not In (comma-separated)' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
] as const;

// Operators for console_level field (excludes 'in' and 'not_in' since we use single-select dropdown)
const CONSOLE_LEVEL_OPERATORS = OPERATOR_OPTIONS.filter(
  (op) => op.value !== 'in' && op.value !== 'not_in'
);

const CONSOLE_LOG_LEVELS = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'log', label: 'Log' },
  { value: 'debug', label: 'Debug' },
] as const;

const FIELD_HELP_KEYS: Record<FilterCondition['field'], string> = {
  priority: 'integrationConfig.conditionsTab.fieldHelpPriority',
  status: 'integrationConfig.conditionsTab.fieldHelpStatus',
  browser: 'integrationConfig.conditionsTab.fieldHelpBrowser',
  os: 'integrationConfig.conditionsTab.fieldHelpOs',
  url_pattern: 'integrationConfig.conditionsTab.fieldHelpUrlPattern',
  user_email: 'integrationConfig.conditionsTab.fieldHelpUserEmail',
  error_message: 'integrationConfig.conditionsTab.fieldHelpErrorMessage',
  project: 'integrationConfig.conditionsTab.fieldHelpProject',
  console_level: 'integrationConfig.conditionsTab.fieldHelpConsoleLevel',
  console_message: 'integrationConfig.conditionsTab.fieldHelpConsoleMessage',
  network_status: 'integrationConfig.conditionsTab.fieldHelpNetworkStatus',
  network_url: 'integrationConfig.conditionsTab.fieldHelpNetworkUrl',
};

const OPERATOR_HELP_KEYS: Record<FilterCondition['operator'], string> = {
  equals: 'integrationConfig.conditionsTab.operatorHelpEquals',
  contains: 'integrationConfig.conditionsTab.operatorHelpContains',
  regex: 'integrationConfig.conditionsTab.operatorHelpRegex',
  in: 'integrationConfig.conditionsTab.operatorHelpIn',
  not_in: 'integrationConfig.conditionsTab.operatorHelpNotIn',
  starts_with: 'integrationConfig.conditionsTab.operatorHelpStartsWith',
  ends_with: 'integrationConfig.conditionsTab.operatorHelpEndsWith',
};

// Constants for special field handling
const CONSOLE_LEVEL_FIELD = 'console_level' as const;
const DEFAULT_CONSOLE_LEVEL = CONSOLE_LOG_LEVELS[0].value;
const INVALID_OPERATORS_FOR_CONSOLE = ['in', 'not_in'] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates and returns a valid console log level value.
 * Falls back to default if the value is invalid.
 */
function getValidatedConsoleLevel(value: string | string[]): string {
  const currentValue = Array.isArray(value) ? value[0] : value;
  const isValidLevel = CONSOLE_LOG_LEVELS.some((level) => level.value === currentValue);
  return isValidLevel ? currentValue : DEFAULT_CONSOLE_LEVEL;
}

/**
 * Checks if an operator requires multiple values (array).
 */
function isMultiValueOperator(operator: string): boolean {
  return operator === 'in' || operator === 'not_in';
}

/**
 * Checks if an operator is invalid for console_level field.
 */
function isInvalidOperatorForConsole(operator: string): boolean {
  return INVALID_OPERATORS_FOR_CONSOLE.includes(
    operator as (typeof INVALID_OPERATORS_FOR_CONSOLE)[number]
  );
}

/**
 * Gets appropriate placeholder text based on operator.
 */
function getPlaceholderText(operator: string): string {
  if (operator === 'regex') {
    return 'Enter regex pattern';
  }
  if (isMultiValueOperator(operator)) {
    return 'value1, value2, value3';
  }
  return 'Enter value';
}

/**
 * Strips _id from filters before passing to parent component.
 */
function stripIds(filters: FilterWithId[]): FilterCondition[] {
  return filters.map(({ _id, ...filter }) => filter);
}

export function RuleBuilder({ filters, onChange }: RuleBuilderProps) {
  const { t } = useTranslation();
  const [localFilters, setLocalFilters] = useState<FilterWithId[]>(() =>
    filters.map((f) => ({ ...f, _id: crypto.randomUUID() }))
  );

  // Synchronize internal state with prop changes (e.g., when editing a different rule)
  // Preserve existing _id values to prevent input focus loss
  useEffect(() => {
    setLocalFilters((prev) => {
      // If the array length changed or it's a completely new set of filters, regenerate IDs
      if (prev.length !== filters.length || filters.length === 0) {
        return filters.map((f) => ({ ...f, _id: crypto.randomUUID() }));
      }

      // Otherwise, preserve existing _id values and just update the filter data
      return filters.map((f, index) => ({
        ...f,
        _id: prev[index]?._id || crypto.randomUUID(),
      }));
    });
  }, [filters]);

  const handleAddFilter = () => {
    const newFilter: FilterWithId = {
      field: 'priority',
      operator: 'equals',
      value: '',
      case_sensitive: false,
      _id: crypto.randomUUID(),
    };
    const updated = [...localFilters, newFilter];
    setLocalFilters(updated);
    onChange(stripIds(updated));
  };

  const handleRemoveFilter = (index: number) => {
    const updated = localFilters.filter((_, i) => i !== index);
    setLocalFilters(updated);
    onChange(stripIds(updated));
  };

  const handleFilterChange = (
    index: number,
    field: keyof FilterCondition,
    value: string | string[] | boolean | undefined
  ) => {
    const updated = [...localFilters];
    const currentFilter = updated[index];

    // When changing the field, ensure operator and value remain valid
    if (field === 'field' && typeof value === 'string') {
      const newField = value;
      const currentOperator = currentFilter.operator;

      // If switching TO console_level, reset operator if invalid and set default value
      if (newField === CONSOLE_LEVEL_FIELD) {
        updated[index] = {
          ...currentFilter,
          field: newField,
          operator: isInvalidOperatorForConsole(currentOperator) ? 'equals' : currentOperator,
          value: DEFAULT_CONSOLE_LEVEL,
        };
      }
      // Otherwise, just update the field
      else {
        updated[index] = { ...currentFilter, [field]: value } as FilterWithId;
      }
    } else {
      updated[index] = { ...currentFilter, [field]: value } as FilterWithId;
    }

    setLocalFilters(updated);
    onChange(stripIds(updated));
  };

  const handleValueChange = (index: number, value: string) => {
    const filter = localFilters[index];
    // For 'in' and 'not_in' operators, convert comma-separated string to array
    if (isMultiValueOperator(filter.operator)) {
      const arrayValue = value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v);
      handleFilterChange(index, 'value', arrayValue);
    } else {
      handleFilterChange(index, 'value', value);
    }
  };

  const getDisplayValue = (filter: FilterCondition): string => {
    if (Array.isArray(filter.value)) {
      return filter.value.join(', ');
    }
    return filter.value;
  };

  // Get available operators for a field
  const getAvailableOperators = (field: string) => {
    // For console_level, use pre-filtered operator list
    if (field === CONSOLE_LEVEL_FIELD) {
      return CONSOLE_LEVEL_OPERATORS;
    }
    return OPERATOR_OPTIONS;
  };

  return (
    <div className="space-y-4">
      {localFilters.map((filter, index) => (
        <Card key={filter._id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                {t('integrations.filterCondition')} {index + 1}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveFilter(index)}
                aria-label={t('integrations.removeFilter', { number: index + 1 })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Field selector */}
              <div className="space-y-2">
                <Label htmlFor={`field-${index}`}>{t('integrations.field')}</Label>
                <Select
                  value={filter.field}
                  onValueChange={(value) =>
                    handleFilterChange(index, 'field', value as FilterCondition['field'])
                  }
                >
                  <SelectTrigger id={`field-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {FIELD_HELP_KEYS[filter.field] && (
                  <p className="text-xs text-gray-500">{t(FIELD_HELP_KEYS[filter.field])}</p>
                )}
              </div>

              {/* Operator selector */}
              <div className="space-y-2">
                <Label htmlFor={`operator-${index}`}>{t('integrations.operator')}</Label>
                <Select
                  value={filter.operator}
                  onValueChange={(value) =>
                    handleFilterChange(index, 'operator', value as FilterCondition['operator'])
                  }
                >
                  <SelectTrigger id={`operator-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableOperators(filter.field).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {OPERATOR_HELP_KEYS[filter.operator] && (
                  <p className="text-xs text-gray-500">{t(OPERATOR_HELP_KEYS[filter.operator])}</p>
                )}
              </div>

              {/* Value input */}
              <div className="space-y-2">
                <Label htmlFor={`value-${index}`}>
                  {t('integrations.value')}
                  {isMultiValueOperator(filter.operator) &&
                    filter.field !== CONSOLE_LEVEL_FIELD && (
                      <span className="text-xs text-gray-500 ml-1">
                        {t('integrations.commaSeparated')}
                      </span>
                    )}
                </Label>
                {filter.field === CONSOLE_LEVEL_FIELD ? (
                  <Select
                    value={getValidatedConsoleLevel(filter.value)}
                    onValueChange={(value) => handleFilterChange(index, 'value', value)}
                  >
                    <SelectTrigger id={`value-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSOLE_LOG_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`value-${index}`}
                    type="text"
                    value={getDisplayValue(filter)}
                    onChange={(e) => handleValueChange(index, e.target.value)}
                    placeholder={getPlaceholderText(filter.operator)}
                  />
                )}
              </div>
            </div>

            {/* Case sensitive checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`case-sensitive-${index}`}
                checked={filter.case_sensitive || false}
                onCheckedChange={(checked) =>
                  handleFilterChange(index, 'case_sensitive', checked === true)
                }
              />
              <Label
                htmlFor={`case-sensitive-${index}`}
                className="text-sm font-normal cursor-pointer"
              >
                {t('integrations.caseSensitive')}
              </Label>
            </div>
            <p className="text-xs text-gray-500 pl-6">
              {t('integrationConfig.conditionsTab.caseSensitiveHelp')}
            </p>
          </CardContent>
        </Card>
      ))}

      <Button type="button" variant="outline" onClick={handleAddFilter} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        {t('integrations.addFilterCondition')}
      </Button>

      {localFilters.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">{t('integrations.noFiltersAdded')}</p>
      )}
    </div>
  );
}
