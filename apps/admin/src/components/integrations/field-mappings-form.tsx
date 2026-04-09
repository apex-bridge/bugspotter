import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { FieldMappings } from '@bugspotter/types';
import { Button } from '../ui/button';
import { MappingRow } from './field-mappings/mapping-row';
import { QuickAddButtons } from './field-mappings/quick-add-buttons';
import { CustomMappingForm } from './field-mappings/custom-mapping-form';
import { JiraHelpText } from './field-mappings/jira-help-text';
import { validateMapping } from './field-mappings/validation';

interface FieldMappingsFormProps {
  mappings: FieldMappings | null;
  onChange: (mappings: FieldMappings | null) => void;
  platform?: string;
}

export function FieldMappingsForm({ mappings, onChange, platform }: FieldMappingsFormProps) {
  const [showCustomField, setShowCustomField] = useState(false);
  const [newJiraField, setNewJiraField] = useState('');
  const [newBugspotterField, setNewBugspotterField] = useState('');
  // Track stable UUIDs for each field ID to prevent focus loss when editing
  const [mappingIds, setMappingIds] = useState<Map<string, string>>(new Map());
  // Track validation errors for inline display
  const [errors, setErrors] = useState<Map<string, { key?: string; value?: string }>>(new Map());

  // Convert FieldMappings object to array for easier UI manipulation
  // Sort entries alphabetically by field ID for predictable rendering order
  const mappingEntries = (
    mappings ? Object.entries(mappings).sort(([a], [b]) => a.localeCompare(b)) : []
  ) as [string, string][];

  // Sync mappingIds with current mappings (handle external updates)
  useEffect(() => {
    if (mappings) {
      setMappingIds((prevIds) => {
        const newIds = new Map(prevIds);
        let changed = false;

        // Add UUIDs for new field IDs
        Object.keys(mappings).forEach((fieldId) => {
          if (!newIds.has(fieldId)) {
            newIds.set(fieldId, crypto.randomUUID());
            changed = true;
          }
        });

        // Remove UUIDs for deleted field IDs
        Array.from(newIds.keys()).forEach((fieldId) => {
          if (!(fieldId in mappings)) {
            newIds.delete(fieldId);
            changed = true;
          }
        });

        return changed ? newIds : prevIds;
      });
    }
  }, [mappings]);

  const handleAddMapping = useCallback(
    (jiraFieldId: string = '', bugspotterField: string = '', allowEmptyValue: boolean = false) => {
      // Trim inputs
      const trimmedFieldId = jiraFieldId.trim();
      const trimmedValue = bugspotterField.trim();

      // Validate inputs (allow empty values for Quick Add buttons)
      const validationErrors = validateMapping(
        trimmedFieldId,
        trimmedValue,
        mappings,
        undefined,
        allowEmptyValue
      );

      if (validationErrors.key) {
        toast.error(validationErrors.key);
        return;
      }

      if (validationErrors.value) {
        toast.error(validationErrors.value);
        return;
      }

      // Add new mapping
      const newMappings = { ...(mappings || {}) };
      newMappings[trimmedFieldId] = trimmedValue;

      // Generate stable UUID for new field ID
      const newIds = new Map(mappingIds);
      newIds.set(trimmedFieldId, crypto.randomUUID());
      setMappingIds(newIds);

      onChange(newMappings);
      setShowCustomField(false);
      setNewJiraField('');
      setNewBugspotterField('');
    },
    [mappings, mappingIds, onChange]
  );

  const handleUpdateMapping = useCallback(
    (oldKey: string, newKey: string, value: string) => {
      // Trim inputs
      const trimmedKey = newKey.trim();
      const trimmedValue = value.trim();

      // Get stable UUID for error tracking
      const stableId = mappingIds.get(oldKey) || oldKey;

      // Validate inputs
      const fieldErrors = validateMapping(trimmedKey, trimmedValue, mappings, oldKey);

      // Update error state
      const newErrors = new Map(errors);
      if (Object.keys(fieldErrors).length > 0) {
        newErrors.set(stableId, fieldErrors);
      } else {
        newErrors.delete(stableId);
      }
      setErrors(newErrors);

      // Always update the mappings (allow invalid input to be visible)
      const newMappings = { ...(mappings || {}) };
      if (oldKey !== trimmedKey) {
        delete newMappings[oldKey];

        // Preserve UUID when renaming field ID
        const newIds = new Map(mappingIds);
        const uuid = newIds.get(oldKey) || crypto.randomUUID();
        newIds.delete(oldKey);
        newIds.set(trimmedKey, uuid);
        setMappingIds(newIds);
      }
      newMappings[trimmedKey] = trimmedValue;
      onChange(newMappings);
    },
    [mappings, mappingIds, errors, onChange]
  );

  const handleRemoveMapping = useCallback(
    (jiraFieldId: string) => {
      const newMappings = { ...(mappings || {}) };
      delete newMappings[jiraFieldId];

      // Remove UUID for deleted field ID
      const newIds = new Map(mappingIds);
      newIds.delete(jiraFieldId);
      setMappingIds(newIds);

      // Clear errors for deleted field
      const stableId = mappingIds.get(jiraFieldId) || jiraFieldId;
      const newErrors = new Map(errors);
      newErrors.delete(stableId);
      setErrors(newErrors);

      onChange(Object.keys(newMappings).length > 0 ? newMappings : null);
    },
    [mappings, mappingIds, errors, onChange]
  );

  const handleClearAll = useCallback(() => {
    setMappingIds(new Map());
    setErrors(new Map());
    onChange(null);
  }, [onChange]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Field Mappings</h4>
          <p className="text-xs text-gray-500">
            Map BugSpotter fields to {platform || 'external'} ticket fields
          </p>
        </div>
        {mappingEntries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            aria-label="Clear all field mappings"
          >
            Clear All
          </Button>
        )}
      </div>

      {/* Existing mappings */}
      {mappingEntries.length > 0 && (
        <div className="space-y-3">
          {mappingEntries.map(([jiraFieldId, bugspotterField]) => {
            const stableKey = mappingIds.get(jiraFieldId) || jiraFieldId;
            const fieldErrors = errors.get(stableKey);

            return (
              <MappingRow
                key={stableKey}
                jiraFieldId={jiraFieldId}
                bugspotterField={bugspotterField ?? ''}
                platform={platform}
                fieldErrors={fieldErrors}
                onUpdate={handleUpdateMapping}
                onRemove={handleRemoveMapping}
              />
            );
          })}
        </div>
      )}

      {/* Quick add buttons for common fields */}
      {platform === 'jira' && !showCustomField && (
        <QuickAddButtons mappings={mappings} onAdd={handleAddMapping} />
      )}

      {/* Add custom mapping */}
      {showCustomField ? (
        <CustomMappingForm
          platform={platform}
          jiraField={newJiraField}
          bugspotterField={newBugspotterField}
          onJiraFieldChange={setNewJiraField}
          onBugspotterFieldChange={setNewBugspotterField}
          onAdd={() => handleAddMapping(newJiraField, newBugspotterField)}
          onCancel={() => {
            setShowCustomField(false);
            setNewJiraField('');
            setNewBugspotterField('');
          }}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowCustomField(true)}>
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          Add Custom Mapping
        </Button>
      )}

      {/* Help text */}
      {platform === 'jira' && <JiraHelpText />}
    </div>
  );
}
