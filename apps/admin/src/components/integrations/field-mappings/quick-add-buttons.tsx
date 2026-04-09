import { Plus } from 'lucide-react';
import type { FieldMappings } from '@bugspotter/types';
import { Button } from '../../ui/button';
import { JIRA_FIELD_SUGGESTIONS } from './constants';

/**
 * Renders quick-add buttons for common field suggestions
 */
interface QuickAddButtonsProps {
  mappings: FieldMappings | null;
  onAdd: (fieldId: string, value: string, allowEmptyValue?: boolean) => void;
}

export function QuickAddButtons({ mappings, onAdd }: QuickAddButtonsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Quick add common fields:</p>
      <div className="flex flex-wrap gap-2">
        {JIRA_FIELD_SUGGESTIONS.map((field) =>
          !mappings || !(field.value in mappings) ? (
            <Button
              key={field.value}
              variant="outline"
              size="sm"
              onClick={() => onAdd(field.value, field.suggestedValue, true)}
              aria-label={`Add ${field.label} field mapping`}
            >
              <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
              {field.label}
            </Button>
          ) : null
        )}
      </div>
    </div>
  );
}
