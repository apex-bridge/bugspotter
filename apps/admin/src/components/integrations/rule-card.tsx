/**
 * Integration Rule Card Component
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Edit,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Copy,
  Download,
  Clipboard,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { IntegrationRule } from '../../types';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { TooltipButton } from '../ui/tooltip-button';

export interface RuleCardProps {
  rule: IntegrationRule;
  readOnly?: boolean;
  onToggleEnabled: (ruleId: string, currentEnabled: boolean) => void;
  onEdit: (rule: IntegrationRule) => void;
  onDelete: (ruleId: string) => void;
  onCopy: (rule: IntegrationRule) => void;
  onExportJson: (rule: IntegrationRule) => void;
  onCopyJson: (rule: IntegrationRule) => void;
}

export function RuleCard({
  rule,
  readOnly,
  onToggleEnabled,
  onEdit,
  onDelete,
  onCopy,
  onExportJson,
  onCopyJson,
}: RuleCardProps) {
  const { t } = useTranslation();
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  return (
    <Card role="article" aria-label={`Rule: ${rule.name}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {rule.name}
              <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              {rule.auto_create && (
                <Badge variant="success" role="status" aria-label="Auto-create enabled">
                  Auto-create
                </Badge>
              )}
              {rule.priority > 0 && <Badge variant="outline">Order: {rule.priority}</Badge>}
            </CardTitle>
            <CardDescription>
              {rule.filters.length} filter{rule.filters.length !== 1 ? 's' : ''}
              {rule.throttle && ' • Throttling enabled'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {/* Primary Actions */}
            <TooltipButton
              variant="ghost"
              size="sm"
              disabled={readOnly}
              onClick={() => onToggleEnabled(rule.id, rule.enabled)}
              aria-label={rule.enabled ? t('tooltips.disableRule') : t('tooltips.enableRule')}
              tooltip={rule.enabled ? t('tooltips.disableRule') : t('tooltips.enableRule')}
            >
              {rule.enabled ? (
                <ToggleRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ToggleLeft className="h-4 w-4" aria-hidden="true" />
              )}
            </TooltipButton>

            <TooltipButton
              variant="ghost"
              size="sm"
              onClick={() => onEdit(rule)}
              aria-label={readOnly ? t('tooltips.viewRule') : t('tooltips.editRule')}
              tooltip={readOnly ? t('tooltips.viewRule') : t('tooltips.editRule')}
            >
              <Edit className="h-4 w-4" aria-hidden="true" />
            </TooltipButton>

            {/* Separator */}
            <div className="h-4 w-px bg-gray-300 mx-1" />

            {/* Secondary Actions */}
            <TooltipButton
              variant="ghost"
              size="sm"
              disabled={readOnly}
              onClick={() => onCopy(rule)}
              aria-label={t('tooltips.copyRule')}
              tooltip={t('tooltips.copyRule')}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </TooltipButton>

            {/* Export Dropdown (read-only safe) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label="Export options">
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onCopyJson(rule)}>
                      <Clipboard className="h-4 w-4 mr-2" aria-hidden="true" />
                      Copy to clipboard
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onExportJson(rule)}>
                      <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                      Download JSON file
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipTrigger>
              <TooltipContent>{t('tooltips.exportRule')}</TooltipContent>
            </Tooltip>

            {/* Separator */}
            <div className="h-4 w-px bg-gray-300 mx-1" />

            {/* Destructive Action */}
            <TooltipButton
              variant="destructive-ghost"
              size="sm"
              disabled={readOnly}
              onClick={() => onDelete(rule.id)}
              aria-label={t('tooltips.deleteRule')}
              tooltip={t('tooltips.deleteRule')}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </TooltipButton>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter summary */}
        {rule.filters.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              className="flex items-center gap-2 text-sm font-medium hover:text-gray-700 transition-colors"
              aria-expanded={filtersExpanded}
              aria-controls="filter-list"
            >
              {filtersExpanded ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
              Filters ({rule.filters.length})
            </button>
            {filtersExpanded && (
              <ul id="filter-list" className="space-y-1 text-sm text-gray-600">
                {rule.filters.map((filter, index) => (
                  <li key={`filter-${index}`}>
                    • <strong>{filter.field}</strong> {filter.operator}{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                      {Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}
                    </code>
                    {filter.case_sensitive && ' (case sensitive)'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Throttle summary */}
        {rule.throttle && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-medium">Throttling:</h4>
            <ul className="space-y-1 text-sm text-gray-600">
              {rule.throttle.max_per_hour && (
                <li>• Max {rule.throttle.max_per_hour} tickets per hour</li>
              )}
              {rule.throttle.max_per_day && (
                <li>• Max {rule.throttle.max_per_day} tickets per day</li>
              )}
              {rule.throttle.group_by && <li>• Grouped by {rule.throttle.group_by}</li>}
              {rule.throttle.digest_mode && (
                <li>
                  • Digest mode enabled (every {rule.throttle.digest_interval_minutes} minutes)
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
