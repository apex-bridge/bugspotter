import { Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { FieldInput } from './field-input';
import { BUGSPOTTER_FIELD_SUGGESTIONS } from './constants';

/**
 * Renders a single mapping row with edit/remove functionality
 */
interface MappingRowProps {
  jiraFieldId: string;
  bugspotterField: string;
  platform?: string;
  fieldErrors?: { key?: string; value?: string };
  onUpdate: (oldKey: string, newKey: string, value: string) => void;
  onRemove: (jiraFieldId: string) => void;
}

export function MappingRow({
  jiraFieldId,
  bugspotterField,
  platform,
  fieldErrors,
  onUpdate,
  onRemove,
}: MappingRowProps) {
  return (
    <div className="grid grid-cols-[1fr,auto,1fr,auto] gap-2 items-end">
      <FieldInput
        id={`jira-field-${jiraFieldId}`}
        label={platform === 'jira' ? 'Jira Field ID' : 'External Field'}
        value={jiraFieldId}
        onChange={(value) => onUpdate(jiraFieldId, value, bugspotterField)}
        placeholder="e.g., priority"
        error={fieldErrors?.key}
      />
      <div className="text-gray-400 pb-2">→</div>
      <FieldInput
        id={`bugspotter-field-${jiraFieldId}`}
        label="BugSpotter Field"
        value={bugspotterField}
        onChange={(value) => onUpdate(jiraFieldId, jiraFieldId, value)}
        placeholder="e.g., priority"
        error={fieldErrors?.value}
        datalistId={`bugspotter-fields-${jiraFieldId}`}
        suggestions={BUGSPOTTER_FIELD_SUGGESTIONS}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onRemove(jiraFieldId)}
        aria-label="Remove mapping"
        className="mb-0.5"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
