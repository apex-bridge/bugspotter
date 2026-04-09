/**
 * Rule Form Dialog Component
 */

import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { IntegrationRule, CreateIntegrationRuleRequest } from '../../types';
import type { FieldMappings } from '@bugspotter/types';
import {
  transformFieldMappingsForApi,
  transformFieldMappingsForUI,
} from '../../utils/field-mappings';
import { validateRuleForm, type RuleFormValues } from '../../utils/rule-validation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { GenericRuleForm } from './generic-rule-form';
import {
  JiraFieldMappingsForm,
  type JiraFieldMappings,
} from '../../integrations/jira/components/jira-field-mappings';

export interface RuleFormDialogProps {
  open: boolean;
  platform: string;
  projectId: string;
  editingRule: IntegrationRule | null;
  onClose: () => void;
  onSubmit: (payload: CreateIntegrationRuleRequest, ruleId?: string) => void;
  isSubmitting: boolean;
  readOnly?: boolean;
}

export function RuleFormDialog({
  open,
  platform,
  projectId,
  editingRule,
  onClose,
  onSubmit,
  isSubmitting,
  readOnly,
}: RuleFormDialogProps) {
  const { t } = useTranslation();

  const handleFormSubmit = (values: RuleFormValues) => {
    // Validate form
    const validationError = validateRuleForm(values);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    // Convert field mappings for API
    const fieldMappingsForApi = transformFieldMappingsForApi(values.fieldMappings);

    const payload: CreateIntegrationRuleRequest = {
      name: values.name.trim(),
      enabled: values.enabled,
      priority: values.priority,
      filters: values.filters,
      throttle: values.throttle,
      auto_create: values.autoCreate,
      field_mappings: fieldMappingsForApi,
      description_template: values.descriptionTemplate?.trim() || null,
    };

    onSubmit(payload, editingRule?.id);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {readOnly
              ? t('integrationRules.viewRule')
              : editingRule
                ? t('integrationRules.editRule')
                : t('integrationRules.createRule')}
          </DialogTitle>
          <DialogDescription>{t('integrationRules.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <GenericRuleForm
          key={editingRule?.id || 'new'}
          platform={platform}
          readOnly={readOnly}
          initialValues={
            editingRule
              ? {
                  name: editingRule.name,
                  enabled: editingRule.enabled,
                  priority: editingRule.priority,
                  filters: editingRule.filters,
                  autoCreate: editingRule.auto_create || false,
                  fieldMappings: transformFieldMappingsForUI(editingRule.field_mappings),
                  throttle: editingRule.throttle,
                  descriptionTemplate: editingRule.description_template || null,
                }
              : undefined
          }
          onSubmit={(values) => {
            handleFormSubmit({
              ...values,
              fieldMappings: values.fieldMappings as FieldMappings | null,
            });
          }}
          onCancel={onClose}
          isSubmitting={isSubmitting}
          renderFieldMappings={
            platform === 'jira'
              ? ({ mappings, onChange }) => (
                  <JiraFieldMappingsForm
                    projectId={projectId}
                    mappings={mappings as JiraFieldMappings | null}
                    onChange={onChange as (mappings: JiraFieldMappings | null) => void}
                  />
                )
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}
