import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';

interface RuleDetailsTabProps {
  name: string;
  onNameChange: (name: string) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  priority: number;
  onPriorityChange: (priority: number) => void;
  autoCreate: boolean;
  onAutoCreateChange: (autoCreate: boolean) => void;
  platform: string;
}

export function RuleDetailsTab({
  name,
  onNameChange,
  enabled,
  onEnabledChange,
  priority,
  onPriorityChange,
  autoCreate,
  onAutoCreateChange,
  platform,
}: RuleDetailsTabProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t('integrationConfig.ruleDetailsTab.introBanner')}</span>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rule-name">{t('integrationConfig.ruleDetailsTab.ruleName')}</Label>
        <Input
          id="rule-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('integrationConfig.ruleDetailsTab.rulePlaceholder')}
          autoFocus
        />
        <p className="text-xs text-gray-500">
          {t('integrationConfig.ruleDetailsTab.ruleDescription')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">{t('integrationConfig.ruleDetailsTab.executionOrder')}</Label>
        <Input
          id="priority"
          type="number"
          min="0"
          value={priority}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10) || 0;
            onPriorityChange(Math.max(0, value));
          }}
        />
        <p className="text-xs text-gray-500">
          {t('integrationConfig.ruleDetailsTab.executionOrderDescription')}
        </p>
      </div>

      <div className="space-y-3 pt-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enabled"
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(checked === true)}
          />
          <Label htmlFor="enabled" className="text-sm font-medium cursor-pointer">
            {t('integrationConfig.ruleDetailsTab.enabled')}
          </Label>
        </div>
        <p className="text-xs text-gray-500 pl-6">
          {t('integrationConfig.ruleDetailsTab.enabledDescription')}
        </p>

        <div className="flex items-start space-x-2 pt-2">
          <Checkbox
            id="auto-create"
            checked={autoCreate}
            onCheckedChange={(checked) => onAutoCreateChange(checked === true)}
            className="mt-0.5"
          />
          <div className="flex-1">
            <Label htmlFor="auto-create" className="text-sm font-medium cursor-pointer">
              {t('integrationConfig.ruleDetailsTab.autoCreateTickets')}
            </Label>
            <p className="text-xs text-gray-500 mt-1">
              {t('integrationConfig.ruleDetailsTab.autoCreateDescription', { platform })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
