import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select-radix';
import { Badge } from '../../../components/ui/badge';
import { JiraUserPicker } from './jira-user-picker';
import { parseArrayField, parsePriority } from './jira-field-mappings.utils';
import { JIRA_PRIORITIES, FIELD_TYPES } from './jira-field-mappings.constants';
import { FieldHeader } from './field-header';

export interface JiraFieldMappings {
  assignee?: string; // JSON: { "accountId": "..." }
  components?: string; // JSON: [{ "name": "..." }]
  labels?: string; // JSON: ["label1", "label2"]
  priority?: string; // JSON: { "name": "High" }
  [key: string]: string | undefined; // Custom fields
}

interface JiraFieldMappingsFormProps {
  projectId: string;
  mappings: JiraFieldMappings | null;
  onChange: (mappings: JiraFieldMappings | null) => void;
}

/**
 * Jira-specific field mappings form
 * Native UI for common Jira fields + custom field support
 */
export function JiraFieldMappingsForm({
  projectId,
  mappings,
  onChange,
}: JiraFieldMappingsFormProps) {
  const { t } = useTranslation();
  const [showCustomField, setShowCustomField] = useState(false);
  const [customFieldId, setCustomFieldId] = useState('');
  const [customFieldValue, setCustomFieldValue] = useState('');
  // Track tag input values for all tag fields (labels, components)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({
    labels: '',
    components: '',
  });

  const updateField = useCallback(
    (fieldId: string, value: string | null) => {
      const newMappings = { ...(mappings || {}) };
      if (value) {
        newMappings[fieldId] = value;
      } else {
        delete newMappings[fieldId];
      }
      onChange(Object.keys(newMappings).length > 0 ? newMappings : null);
    },
    [mappings, onChange]
  );

  // Update array field (components or labels)
  const updateArrayField = useCallback(
    (fieldId: string, items: string[]) => {
      if (items.length === 0) {
        updateField(fieldId, null);
      } else {
        // Find field configuration to determine array format
        const fieldConfig = FIELD_TYPES.find((f) => f.id === fieldId);
        const arrayFormat =
          fieldConfig && 'arrayFormat' in fieldConfig ? fieldConfig.arrayFormat : 'string';

        // Format JSON based on field configuration
        const jsonValue =
          arrayFormat === 'object'
            ? JSON.stringify(items.map((name) => ({ name })))
            : JSON.stringify(items);
        updateField(fieldId, jsonValue);
      }
    },
    [updateField]
  );

  // Update priority field
  const updatePriority = useCallback(
    (priority: string | null) => {
      if (!priority) {
        updateField('priority', null);
      } else {
        updateField('priority', JSON.stringify({ name: priority }));
      }
    },
    [updateField]
  );

  const resetCustomField = useCallback(() => {
    setShowCustomField(false);
    setCustomFieldId('');
    setCustomFieldValue('');
  }, []);

  const addCustomField = useCallback(() => {
    if (!customFieldId.trim() || !customFieldValue.trim()) {
      return;
    }
    updateField(customFieldId.trim(), customFieldValue.trim());
    resetCustomField();
  }, [customFieldId, customFieldValue, updateField, resetCustomField]);

  const removeField = useCallback(
    (fieldId: string) => {
      const newMappings = { ...(mappings || {}) };
      delete newMappings[fieldId];
      onChange(Object.keys(newMappings).length > 0 ? newMappings : null);
    },
    [mappings, onChange]
  );

  // Add tag to a field's array
  const addTag = useCallback(
    (fieldId: string) => {
      const inputValue = tagInputs[fieldId] || '';
      const trimmed = inputValue.trim();
      const currentValue = mappings?.[fieldId] || '';
      const items = parseArrayField(currentValue);

      if (trimmed && !items.includes(trimmed)) {
        updateArrayField(fieldId, [...items, trimmed]);
        setTagInputs((prev) => ({ ...prev, [fieldId]: '' }));
      }
    },
    [tagInputs, mappings, updateArrayField]
  );

  // Remove tag from a field's array
  const removeTag = useCallback(
    (fieldId: string, tag: string) => {
      const currentValue = mappings?.[fieldId] || '';
      const items = parseArrayField(currentValue);
      updateArrayField(
        fieldId,
        items.filter((t) => t !== tag)
      );
    },
    [mappings, updateArrayField]
  );

  // Separate standard and custom fields
  const standardFieldIds = useMemo(() => new Set<string>(FIELD_TYPES.map((f) => f.id)), []);
  const customFields = useMemo(
    () => Object.keys(mappings || {}).filter((k) => !standardFieldIds.has(k)),
    [mappings, standardFieldIds]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium" data-testid="field-mappings-section">
            {t('pages.jira.fieldMappingsTitle')}
          </h4>
          <p className="text-xs text-gray-500">{t('pages.jira.fieldMappingsDescription')}</p>
        </div>
        {mappings && Object.keys(mappings).length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            data-testid="clear-all-fields"
          >
            {t('pages.jira.clearAll')}
          </Button>
        )}
      </div>

      {/* Standard Jira fields */}
      <div className="space-y-4">
        {(() => {
          // Hoist translation maps outside the per-field loop
          const fieldLabelMap: Record<string, string> = {
            assignee: t('pages.jira.fieldAssignee'),
            components: t('pages.jira.fieldComponents'),
            labels: t('pages.jira.fieldLabels'),
            priority: t('pages.jira.fieldPriority'),
          };
          const singularLabelMap: Record<string, string> = {
            components: t('pages.jira.fieldComponentSingular'),
            labels: t('pages.jira.fieldLabelSingular'),
          };
          const placeholderMap: Record<string, string> = {
            components: t('pages.jira.placeholderComponents'),
            labels: t('pages.jira.placeholderLabels'),
          };
          return FIELD_TYPES.map((field) => {
            const hasValue = mappings && field.id in mappings;
            const value = mappings?.[field.id] || '';

            const fieldLabel = fieldLabelMap[field.id] || field.label;

            // Render user picker
            if (field.type === 'user-picker') {
              return (
                <div key={field.id} className="space-y-2">
                  <FieldHeader
                    fieldId={field.id}
                    label={fieldLabel}
                    hasValue={!!hasValue}
                    onRemove={() => removeField(field.id)}
                  />
                  <JiraUserPicker
                    projectId={projectId}
                    value={value}
                    onChange={(v) => updateField(field.id, v)}
                    placeholder={t('pages.jira.placeholderUserSearch')}
                    data-testid={`jira-${field.id}`}
                  />
                </div>
              );
            }

            // Render priority dropdown
            if (field.type === 'select') {
              const currentPriority = parsePriority(value);
              return (
                <div key={field.id} className="space-y-2">
                  <FieldHeader
                    fieldId={field.id}
                    label={fieldLabel}
                    hasValue={!!hasValue}
                    onRemove={() => updatePriority(null)}
                  />
                  <Select value={currentPriority || ''} onValueChange={(v) => updatePriority(v)}>
                    <SelectTrigger id={`jira-${field.id}`} data-testid={`jira-${field.id}`}>
                      <SelectValue placeholder={t('pages.jira.selectPriority')} />
                    </SelectTrigger>
                    <SelectContent>
                      {JIRA_PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {priority}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            // Render tag input (components, labels)
            if (field.type === 'tags') {
              const items = parseArrayField(value);
              const inputValue = tagInputs[field.id] || '';
              const singularLabel = singularLabelMap[field.id] || field.singularLabel;
              const tagPlaceholder = placeholderMap[field.id] || field.placeholder;

              return (
                <div key={field.id} className="space-y-2">
                  <FieldHeader
                    fieldId={field.id}
                    label={fieldLabel}
                    hasValue={items.length > 0}
                    onRemove={() => updateArrayField(field.id, [])}
                    removeLabel={t('pages.jira.clearAllItems', { items: fieldLabel.toLowerCase() })}
                  />
                  <div className="space-y-2">
                    {/* Display existing tags */}
                    {items.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {items.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="pl-2 pr-1"
                            data-testid={`tag-${field.id}-${tag}`}
                            role="status"
                            aria-label={`${singularLabel}: ${tag}`}
                          >
                            {tag}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTag(field.id, tag)}
                              className="ml-1 h-auto p-0.5 hover:bg-accent rounded-full"
                              aria-label={t('pages.jira.removeItem', { item: tag })}
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {/* Input for adding new tags */}
                    <div className="flex gap-2">
                      <Input
                        id={`jira-${field.id}`}
                        data-testid={`jira-${field.id}`}
                        value={inputValue}
                        onChange={(e) =>
                          setTagInputs((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(field.id);
                          }
                        }}
                        placeholder={tagPlaceholder}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => addTag(field.id)}
                        disabled={!inputValue.trim()}
                        aria-label={t('pages.jira.addItems', { items: fieldLabel.toLowerCase() })}
                        data-testid={`add-${field.id}-button`}
                      >
                        {t('common.add')}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          });
        })()}
      </div>

      {/* Custom fields */}
      {customFields.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <h5 className="text-sm font-medium text-gray-700" data-testid="custom-fields-heading">
            {t('pages.jira.customFields')}
          </h5>
          {customFields.map((fieldId) => (
            <div key={fieldId} className="flex gap-2">
              <Input value={fieldId} disabled className="flex-1" />
              <Input
                value={mappings?.[fieldId] || ''}
                onChange={(e) => updateField(fieldId, e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeField(fieldId)}
                data-testid="remove-custom-field-button"
                aria-label={t('pages.jira.removeCustomField')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add custom field */}
      {showCustomField ? (
        <div className="space-y-2 border rounded-md p-4 bg-gray-50">
          <Label htmlFor="custom-field-id" className="text-sm font-medium">
            {t('pages.jira.customFieldId')}
          </Label>
          <Input
            id="custom-field-id"
            data-testid="custom-field-id"
            value={customFieldId}
            onChange={(e) => setCustomFieldId(e.target.value)}
            placeholder={t('pages.jira.customFieldIdPlaceholder')}
          />
          <Label htmlFor="custom-field-value" className="text-sm font-medium">
            {t('pages.jira.customFieldValue')}
          </Label>
          <Input
            id="custom-field-value"
            data-testid="custom-field-value"
            value={customFieldValue}
            onChange={(e) => setCustomFieldValue(e.target.value)}
            placeholder={t('pages.jira.customFieldValuePlaceholder')}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={addCustomField}
              data-testid="add-custom-field-button"
            >
              {t('common.add')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetCustomField}
              data-testid="cancel-custom-field-button"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCustomField(true)}
          data-testid="add-custom-field-trigger"
        >
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('pages.jira.addCustomField')}
        </Button>
      )}

      <div className="text-xs text-gray-500 border-t pt-2" data-testid="field-mappings-help">
        <p className="font-medium">{t('pages.jira.fieldInfoTitle')}</p>
        <ul className="list-disc list-inside space-y-1 mt-1">
          <li>{t('pages.jira.fieldInfoPriority')}</li>
          <li>{t('pages.jira.fieldInfoComponentsLabels')}</li>
          <li>{t('pages.jira.fieldInfoAssignee')}</li>
          <li>{t('pages.jira.fieldInfoCustomFields')}</li>
        </ul>
      </div>
    </div>
  );
}
