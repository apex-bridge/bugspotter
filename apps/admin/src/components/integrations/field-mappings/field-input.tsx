import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { cn } from '../../../lib/utils';

/**
 * Reusable field input component with label, error message, and optional datalist
 */
interface FieldInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  datalistId?: string;
  suggestions?: Array<{ value: string; label: string }>;
}

export function FieldInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  datalistId,
  suggestions,
}: FieldInputProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={datalistId}
        className={cn(error && 'border-red-500')}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {datalistId && suggestions && (
        <datalist id={datalistId}>
          {suggestions.map((field) => (
            <option key={field.value} value={field.value}>
              {field.label}
            </option>
          ))}
        </datalist>
      )}
    </div>
  );
}
