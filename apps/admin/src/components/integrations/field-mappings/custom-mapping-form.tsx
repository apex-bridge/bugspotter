import { Button } from '../../ui/button';
import { FieldInput } from './field-input';
import { JIRA_FIELD_SUGGESTIONS, BUGSPOTTER_FIELD_SUGGESTIONS } from './constants';

/**
 * Renders the custom field mapping form
 */
interface CustomMappingFormProps {
  platform?: string;
  jiraField: string;
  bugspotterField: string;
  onJiraFieldChange: (value: string) => void;
  onBugspotterFieldChange: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}

export function CustomMappingForm({
  platform,
  jiraField,
  bugspotterField,
  onJiraFieldChange,
  onBugspotterFieldChange,
  onAdd,
  onCancel,
}: CustomMappingFormProps) {
  const isAddDisabled = !jiraField.trim() || !bugspotterField.trim();

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
        <FieldInput
          id="new-jira-field"
          label={platform === 'jira' ? 'Jira Field ID' : 'External Field'}
          value={jiraField}
          onChange={onJiraFieldChange}
          placeholder="e.g., customfield_10001"
          datalistId={platform === 'jira' ? 'jira-field-suggestions' : undefined}
          suggestions={platform === 'jira' ? JIRA_FIELD_SUGGESTIONS : undefined}
        />
        <div className="text-gray-400 pb-1">→</div>
        <FieldInput
          id="new-bugspotter-field"
          label="BugSpotter Field"
          value={bugspotterField}
          onChange={onBugspotterFieldChange}
          placeholder="e.g., priority"
          datalistId="bugspotter-fields-new"
          suggestions={BUGSPOTTER_FIELD_SUGGESTIONS}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onAdd} disabled={isAddDisabled}>
          Add Mapping
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
