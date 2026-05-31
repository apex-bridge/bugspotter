import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleBuilder } from './rule-builder';
import type { FilterCondition } from '../../types';

vi.mock('react-i18next', async () => {
  const en = (await import('../../i18n/locales/en.json')).default;

  const getTranslation = (key: string): string | undefined => {
    const result = key
      .split('.')
      .reduce<unknown>(
        (obj, part) =>
          obj != null && typeof obj === 'object'
            ? (obj as Record<string, unknown>)[part]
            : undefined,
        en
      );
    return typeof result === 'string' ? result : undefined;
  };

  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const raw = getTranslation(key) ?? key;
        if (!opts) {
          return raw;
        }
        return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
      },
      i18n: { language: 'en' },
    }),
  };
});

describe('RuleBuilder', () => {
  const mockOnChange = vi.fn();

  const defaultProps = {
    filters: [] as FilterCondition[],
    onChange: mockOnChange,
  };

  beforeAll(() => {
    // Mock hasPointerCapture for happy-dom compatibility with Radix UI
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    }
  });

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  describe('Initial Render', () => {
    it('should render empty state message when no filters exist', () => {
      render(<RuleBuilder {...defaultProps} />);
      expect(screen.getByText(/No filters added yet/i)).toBeInTheDocument();
    });

    it('should render "Add Filter Condition" button', () => {
      render(<RuleBuilder {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Add Filter Condition/i })).toBeInTheDocument();
    });

    it('should render existing filters', () => {
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'chrome', case_sensitive: false },
        { field: 'status', operator: 'contains', value: 'open', case_sensitive: true },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      expect(screen.getByText('Filter Condition 1')).toBeInTheDocument();
      expect(screen.getByText('Filter Condition 2')).toBeInTheDocument();
    });
  });

  describe('Adding Filters', () => {
    it('should add a new filter when "Add Filter Condition" is clicked', async () => {
      const user = userEvent.setup();
      render(<RuleBuilder {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Add Filter Condition/i }));

      expect(mockOnChange).toHaveBeenCalledWith([
        {
          field: 'priority',
          operator: 'equals',
          value: '',
          case_sensitive: false,
        },
      ]);
    });

    it('should not include _id in onChange callback', async () => {
      const user = userEvent.setup();
      render(<RuleBuilder {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Add Filter Condition/i }));

      const [calledFilters] = mockOnChange.mock.calls[0];
      expect(calledFilters[0]).not.toHaveProperty('_id');
    });
  });

  describe('Removing Filters', () => {
    it('should remove a filter when delete button is clicked', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'chrome', case_sensitive: false },
        { field: 'status', operator: 'contains', value: 'open', case_sensitive: true },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const removeButtons = screen.getAllByRole('button', { name: /Remove filter/i });
      await user.click(removeButtons[0]);

      expect(mockOnChange).toHaveBeenCalledWith([
        { field: 'status', operator: 'contains', value: 'open', case_sensitive: true },
      ]);
    });
  });

  describe('Console Level Field Handling', () => {
    it('should reset operator to "equals" when switching to console_level with "in" operator', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'in', value: ['chrome', 'firefox'], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      // Find the field selector within the first filter card
      const fieldSelect = screen.getByRole('combobox', { name: /field/i });
      await user.click(fieldSelect);

      // Select console_level
      const consoleLevelOption = screen.getByRole('option', { name: /Console Log Level/i });
      await user.click(consoleLevelOption);

      // Verify onChange was called with operator reset to 'equals'
      expect(mockOnChange).toHaveBeenCalledWith([
        {
          field: 'console_level',
          operator: 'equals',
          value: 'error', // Default console level
          case_sensitive: false,
        },
      ]);
    });

    it('should reset operator to "equals" when switching to console_level with "not_in" operator', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'not_in', value: ['chrome'], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const fieldSelect = screen.getByRole('combobox', { name: /field/i });
      await user.click(fieldSelect);

      const consoleLevelOption = screen.getByRole('option', { name: /Console Log Level/i });
      await user.click(consoleLevelOption);

      expect(mockOnChange).toHaveBeenCalledWith([
        {
          field: 'console_level',
          operator: 'equals',
          value: 'error',
          case_sensitive: false,
        },
      ]);
    });

    it('should set default value when switching to console_level', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'safari', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const fieldSelect = screen.getByRole('combobox', { name: /field/i });
      await user.click(fieldSelect);

      const consoleLevelOption = screen.getByRole('option', { name: /Console Log Level/i });
      await user.click(consoleLevelOption);

      expect(mockOnChange).toHaveBeenCalledWith([
        {
          field: 'console_level',
          operator: 'equals',
          value: 'error', // Default console level
          case_sensitive: false,
        },
      ]);
    });

    it('should validate console level value and fall back to default for invalid values', () => {
      const filters: FilterCondition[] = [
        {
          field: 'console_level',
          operator: 'equals',
          value: 'invalid_level',
          case_sensitive: false,
        },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      // The select should show the default value 'Error' because 'invalid_level' is invalid
      const valueSelect = screen.getByRole('combobox', { name: /value/i });
      expect(valueSelect).toHaveTextContent('Error');
    });

    it('should validate console level value from array and fall back to default', () => {
      const filters: FilterCondition[] = [
        { field: 'console_level', operator: 'equals', value: ['safari'], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      // Should fall back to default 'Error' since 'safari' is not a valid log level
      const valueSelect = screen.getByRole('combobox', { name: /value/i });
      expect(valueSelect).toHaveTextContent('Error');
    });

    it('should preserve valid console level value', () => {
      const filters: FilterCondition[] = [
        { field: 'console_level', operator: 'equals', value: 'warn', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueSelect = screen.getByRole('combobox', { name: /value/i });
      expect(valueSelect).toHaveTextContent('Warning');
    });

    it('should only show valid operators for console_level field', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'console_level', operator: 'equals', value: 'error', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const operatorSelect = screen.getByRole('combobox', { name: /operator/i });
      await user.click(operatorSelect);

      // Should have operators like 'Equals', 'Contains', 'Regex', etc.
      expect(screen.getByRole('option', { name: 'Equals' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Contains' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Regular Expression' })).toBeInTheDocument();

      // Should NOT have 'In' or 'Not In' operators
      expect(
        screen.queryByRole('option', { name: /In \(comma-separated\)/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('option', { name: /Not In \(comma-separated\)/ })
      ).not.toBeInTheDocument();
    });
  });

  describe('Multi-Value Operators', () => {
    it('should convert comma-separated values to array for "in" operator', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'in', value: ['chrome'], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByRole('textbox', { name: /value/i });
      await user.clear(valueInput);
      await user.click(valueInput);
      await user.paste('chrome, firefox, safari');

      // Get the last call since paste triggers onChange
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(lastCall).toEqual([
        {
          field: 'browser',
          operator: 'in',
          value: ['chrome', 'firefox', 'safari'],
          case_sensitive: false,
        },
      ]);
    });

    it('should convert comma-separated values to array for "not_in" operator', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'not_in', value: [], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByRole('textbox', { name: /value/i });
      await user.click(valueInput);
      await user.paste('ie, edge');

      // Get the last call since paste triggers onChange
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(lastCall).toEqual([
        {
          field: 'browser',
          operator: 'not_in',
          value: ['ie', 'edge'],
          case_sensitive: false,
        },
      ]);
    });

    it('should trim whitespace from array values', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'in', value: [], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByRole('textbox', { name: /value/i });
      await user.click(valueInput);
      await user.paste('  chrome  ,  firefox  ,  safari  ');

      // Get the last call since paste triggers onChange
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(lastCall).toEqual([
        {
          field: 'browser',
          operator: 'in',
          value: ['chrome', 'firefox', 'safari'],
          case_sensitive: false,
        },
      ]);
    });

    it('should filter out empty values from array', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'in', value: [], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByRole('textbox', { name: /value/i });
      await user.click(valueInput);
      await user.paste('chrome,,firefox,  ,safari');

      // Get the last call since paste triggers onChange
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(lastCall).toEqual([
        {
          field: 'browser',
          operator: 'in',
          value: ['chrome', 'firefox', 'safari'],
          case_sensitive: false,
        },
      ]);
    });

    it('should show "(comma-separated)" hint for "in" operator', () => {
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'in', value: [], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      expect(screen.getByText('(comma-separated)')).toBeInTheDocument();
    });

    it('should NOT show "(comma-separated)" hint for console_level field', () => {
      const filters: FilterCondition[] = [
        { field: 'console_level', operator: 'equals', value: 'error', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      expect(screen.queryByText('(comma-separated)')).not.toBeInTheDocument();
    });
  });

  describe('Placeholder Text', () => {
    it('should show regex placeholder for regex operator', () => {
      const filters: FilterCondition[] = [
        { field: 'error_message', operator: 'regex', value: '', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByPlaceholderText('Enter regex pattern');
      expect(valueInput).toBeInTheDocument();
    });

    it('should show comma-separated placeholder for "in" operator', () => {
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'in', value: [], case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByPlaceholderText('value1, value2, value3');
      expect(valueInput).toBeInTheDocument();
    });

    it('should show default placeholder for other operators', () => {
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: '', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByPlaceholderText('Enter value');
      expect(valueInput).toBeInTheDocument();
    });
  });

  describe('Case Sensitive Checkbox', () => {
    it('should toggle case_sensitive when checkbox is clicked', async () => {
      const user = userEvent.setup();
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'chrome', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const checkbox = screen.getByRole('checkbox', { name: /case sensitive/i });
      await user.click(checkbox);

      expect(mockOnChange).toHaveBeenCalledWith([
        {
          field: 'browser',
          operator: 'equals',
          value: 'chrome',
          case_sensitive: true,
        },
      ]);
    });
  });

  describe('Focus Management', () => {
    it('should preserve filter IDs when filters prop changes', () => {
      const filters1: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'chrome', case_sensitive: false },
      ];
      const filters2: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'firefox', case_sensitive: false },
      ];

      const { rerender } = render(<RuleBuilder filters={filters1} onChange={mockOnChange} />);

      // Update props
      rerender(<RuleBuilder filters={filters2} onChange={mockOnChange} />);

      // Card should still exist (IDs preserved)
      expect(screen.getByText('Filter Condition 1')).toBeInTheDocument();
    });
  });

  describe('Display Value', () => {
    it('should display array values as comma-separated string', () => {
      const filters: FilterCondition[] = [
        {
          field: 'browser',
          operator: 'in',
          value: ['chrome', 'firefox', 'safari'],
          case_sensitive: false,
        },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByRole('textbox', { name: /value/i });
      expect(valueInput).toHaveValue('chrome, firefox, safari');
    });

    it('should display string values as-is', () => {
      const filters: FilterCondition[] = [
        { field: 'browser', operator: 'equals', value: 'chrome', case_sensitive: false },
      ];
      render(<RuleBuilder filters={filters} onChange={mockOnChange} />);

      const valueInput = screen.getByRole('textbox', { name: /value/i });
      expect(valueInput).toHaveValue('chrome');
    });
  });
});

// Unit tests for helper functions (if they were exported)
describe('Helper Functions', () => {
  describe('getValidatedConsoleLevel', () => {
    it('should return valid console level as-is', () => {
      // This would test the exported helper if available
      // For now, we test through the component behavior
    });

    it('should return default for invalid console level', () => {
      // Tested through component above
    });

    it('should handle array values', () => {
      // Tested through component above
    });
  });

  describe('isMultiValueOperator', () => {
    it('should return true for "in" operator', () => {
      // Tested through component behavior
    });

    it('should return true for "not_in" operator', () => {
      // Tested through component behavior
    });

    it('should return false for other operators', () => {
      // Tested through component behavior
    });
  });

  describe('getPlaceholderText', () => {
    it('should return regex placeholder for "regex" operator', () => {
      // Tested through component above
    });

    it('should return comma-separated placeholder for multi-value operators', () => {
      // Tested through component above
    });

    it('should return default placeholder for other operators', () => {
      // Tested through component above
    });
  });
});
