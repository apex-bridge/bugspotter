import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { DialogFooter } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { RuleDetailsTab } from './rule-details-tab';
import { ConditionsTab } from './conditions-tab';
import { FieldMappingsTab } from './field-mappings-tab';
import { AdvancedTab } from './advanced-tab';
import type { FilterCondition, ThrottleConfig } from '../../types';
import type { FieldMappings } from '@bugspotter/types';

interface GenericRuleFormValues {
  name: string;
  enabled: boolean;
  priority: number;
  filters: FilterCondition[];
  throttle: ThrottleConfig | null;
  autoCreate: boolean;
  fieldMappings: FieldMappings | null;
  descriptionTemplate: string | null;
}

interface GenericRuleFormProps {
  platform: string;
  initialValues?: GenericRuleFormValues;
  onSubmit: (values: GenericRuleFormValues) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  readOnly?: boolean;
  // Optional: render custom field mappings UI (platform-specific)
  renderFieldMappings?: (props: {
    mappings: FieldMappings | null;
    onChange: (mappings: FieldMappings | null) => void;
  }) => React.ReactNode;
}

export function GenericRuleForm({
  platform,
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting,
  readOnly,
  renderFieldMappings,
}: GenericRuleFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialValues?.name || '');
  const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
  const [priority, setPriority] = useState(initialValues?.priority || 0);
  const [filters, setFilters] = useState<FilterCondition[]>(initialValues?.filters || []);
  const [throttle, setThrottle] = useState<ThrottleConfig | null>(initialValues?.throttle || null);
  const [autoCreate, setAutoCreate] = useState(initialValues?.autoCreate || false);
  const [fieldMappings, setFieldMappings] = useState<FieldMappings | null>(
    initialValues?.fieldMappings || null
  );
  const [descriptionTemplate, setDescriptionTemplate] = useState<string | null>(
    initialValues?.descriptionTemplate ?? null
  );

  // Update form when initialValues change (e.g., switching between create/edit)
  useEffect(() => {
    if (initialValues) {
      setName(initialValues.name);
      setEnabled(initialValues.enabled);
      setPriority(initialValues.priority);
      setFilters(initialValues.filters);
      setThrottle(initialValues.throttle);
      setAutoCreate(initialValues.autoCreate);
      setFieldMappings(initialValues.fieldMappings);
      setDescriptionTemplate(initialValues.descriptionTemplate ?? null);
    }
  }, [initialValues]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      enabled,
      priority,
      filters,
      throttle,
      autoCreate,
      fieldMappings,
      descriptionTemplate,
    });
  };

  // Memoized callbacks to prevent re-renders
  const handleNameChange = useCallback((value: string) => setName(value), []);
  const handleEnabledChange = useCallback((value: boolean) => setEnabled(value), []);
  const handlePriorityChange = useCallback((value: number) => setPriority(value), []);
  const handleAutoCreateChange = useCallback((value: boolean) => setAutoCreate(value), []);
  const handleFiltersChange = useCallback((value: FilterCondition[]) => setFilters(value), []);
  const handleFieldMappingsChange = useCallback(
    (value: FieldMappings | null) => setFieldMappings(value),
    []
  );
  const handleDescriptionTemplateChange = useCallback((value: string | null) => {
    setDescriptionTemplate(value);
  }, []);
  const handleThrottleChange = useCallback(
    (value: ThrottleConfig | null) => setThrottle(value),
    []
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-y-auto py-4">
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">{t('integrations.tabRuleDetails')}</TabsTrigger>
            <TabsTrigger value="conditions">{t('integrations.tabConditions')}</TabsTrigger>
            <TabsTrigger value="mappings">{t('integrations.tabFieldMappings')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('integrations.tabAdvanced')}</TabsTrigger>
          </TabsList>

          <fieldset disabled={readOnly}>
            <TabsContent value="details" className="mt-0">
              <RuleDetailsTab
                name={name}
                onNameChange={handleNameChange}
                enabled={enabled}
                onEnabledChange={handleEnabledChange}
                priority={priority}
                onPriorityChange={handlePriorityChange}
                autoCreate={autoCreate}
                onAutoCreateChange={handleAutoCreateChange}
                platform={platform}
              />
            </TabsContent>

            <TabsContent value="conditions" className="mt-0">
              <ConditionsTab filters={filters} onFiltersChange={handleFiltersChange} />
            </TabsContent>

            <TabsContent value="mappings" className="mt-0">
              <FieldMappingsTab
                autoCreate={autoCreate}
                platform={platform}
                fieldMappings={fieldMappings || {}}
                onFieldMappingsChange={handleFieldMappingsChange}
                descriptionTemplate={descriptionTemplate || ''}
                onDescriptionTemplateChange={handleDescriptionTemplateChange}
                renderFieldMappings={renderFieldMappings}
              />
            </TabsContent>

            <TabsContent value="advanced" className="mt-0">
              <AdvancedTab
                throttleConfig={throttle}
                onThrottleConfigChange={handleThrottleChange}
              />
            </TabsContent>
          </fieldset>
        </Tabs>
      </div>

      <DialogFooter className="flex-shrink-0 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          {readOnly ? t('common.close') : t('common.cancel')}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={isSubmitting || !name.trim()}>
            {initialValues ? t('integrations.updateRule') : t('integrations.createRule')}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
