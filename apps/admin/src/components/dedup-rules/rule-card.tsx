/**
 * Card for a single dedup rule. Renders name + enable toggle +
 * trigger badge + a short action summary. Edit / delete kebab.
 *
 * Kept deliberately simple compared to `IntegrationRuleCard` — no
 * copy-to-other-project (dedup rules are project-specific) and no
 * JSON export (PR-D2 scope is admin CRUD only).
 */

import { Edit, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { ActionSpec, DedupRuleRow, TriggerSpec } from '../../services/dedup-rules-service';

interface DedupRuleCardProps {
  rule: DedupRuleRow;
  readOnly?: boolean;
  onToggleEnabled: (ruleId: string, currentEnabled: boolean) => void;
  onEdit: (rule: DedupRuleRow) => void;
  onDelete: (ruleId: string) => void;
}

function summarizeTrigger(trigger: TriggerSpec, t: (k: string) => string): string {
  switch (trigger.type) {
    case 'duplicate_detected':
      return t('dedupRules.trigger.duplicate_detected');
    case 'outbox_about_to_skip':
      return t('dedupRules.trigger.outbox_about_to_skip');
    case 'cluster_growing':
      return `${t('dedupRules.trigger.cluster_growing')} (${trigger.threshold}/${trigger.window})`;
    case 'schedule':
      return `${t('dedupRules.trigger.schedule')} (${trigger.cron})`;
  }
}

function summarizeAction(action: ActionSpec, t: (k: string) => string): string {
  switch (action.type) {
    case 'ticket.add_comment':
      return t('dedupRules.action.ticket_add_comment');
    case 'ticket.transition':
      return `${t('dedupRules.action.ticket_transition')} → ${action.to}`;
    case 'notify.email':
      return `${t('dedupRules.action.notify_email')} → ${action.to}`;
    case 'notify.slack':
      return t('dedupRules.action.notify_slack');
    case 'notify.webhook':
      return t('dedupRules.action.notify_webhook');
  }
}

export function DedupRuleCard({
  rule,
  readOnly,
  onToggleEnabled,
  onEdit,
  onDelete,
}: DedupRuleCardProps) {
  const { t } = useTranslation();
  const body = rule.rule_json;
  const triggerLabel = summarizeTrigger(body.when, t);
  const actionLabels = body.then.map((a) => summarizeAction(a, t)).join(', ');

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-lg flex items-center gap-2">
            {rule.name}
            {!rule.enabled && (
              <Badge variant="secondary" className="text-xs">
                {t('dedupRules.disabled')}
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <Badge variant="outline">{triggerLabel}</Badge>
            <span>→</span>
            <span>{actionLabels}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            aria-label={
              rule.enabled ? t('dedupRules.aria.disableRule') : t('dedupRules.aria.enableRule')
            }
            onClick={() => onToggleEnabled(rule.id, rule.enabled)}
          >
            {rule.enabled ? (
              <ToggleRight className="h-5 w-5 text-green-600" />
            ) : (
              <ToggleLeft className="h-5 w-5 text-gray-400" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            aria-label={t('dedupRules.aria.editRule')}
            onClick={() => onEdit(rule)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            aria-label={t('dedupRules.aria.deleteRule')}
            onClick={() => onDelete(rule.id)}
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      </CardHeader>
      {body.rate_limit && (
        <CardContent className="pt-0 text-xs text-gray-500">
          {t('dedupRules.rateLimitLabel', {
            count: body.rate_limit.count,
            window: body.rate_limit.window,
          })}
        </CardContent>
      )}
    </Card>
  );
}
