import { Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';

interface FieldHeaderProps {
  fieldId: string;
  label: string;
  hasValue: boolean;
  onRemove: () => void;
  removeLabel?: string;
}

/**
 * Reusable field header with label and optional remove button
 */
export function FieldHeader({ fieldId, label, hasValue, onRemove, removeLabel }: FieldHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={`jira-${fieldId}`} className="text-sm font-medium">
        {label}
      </Label>
      {hasValue && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={removeLabel || `Remove ${label}`}
          data-testid={`remove-${fieldId}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
