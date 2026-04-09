/**
 * JiraFieldMappingsForm Component Tests
 * Tests for Jira-specific field mapping UI
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JiraFieldMappingsForm } from '../../integrations/jira/components/jira-field-mappings';

// Mock JiraUserPicker component
vi.mock('../../integrations/jira/components/jira-user-picker', () => ({
  JiraUserPicker: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (v: string) => void;
  }) => (
    <input
      id="jira-assignee"
      data-testid="mock-user-picker"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Select Jira user"
    />
  ),
}));

describe('JiraFieldMappingsForm', () => {
  const mockProjectId = 'proj-123';
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render standard Jira fields', () => {
    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    expect(screen.getByText(/jira field mappings/i)).toBeInTheDocument();
    expect(screen.getByTestId('mock-user-picker')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /components/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /labels/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /priority/i })).toBeInTheDocument();
  });

  it('should display JiraUserPicker for assignee field', () => {
    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    expect(screen.getByTestId('mock-user-picker')).toBeInTheDocument();
  });

  it('should update assignee field value', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    const userPicker = screen.getByTestId('mock-user-picker');
    await user.clear(userPicker);
    await user.paste('{"accountId":"acc-123"}');

    expect(mockOnChange).toHaveBeenCalledWith({
      assignee: '{"accountId":"acc-123"}',
    });
  });

  it('should add components using tag input', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    const componentsInput = screen.getByRole('textbox', { name: /components/i });
    await user.type(componentsInput, 'Frontend');
    await user.click(screen.getByRole('button', { name: /add components/i }));

    expect(mockOnChange).toHaveBeenCalledWith({
      components: '[{"name":"Frontend"}]',
    });
  });

  it('should add labels using tag input', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    const labelsInput = screen.getByRole('textbox', { name: /labels/i });
    await user.type(labelsInput, 'urgent');
    await user.click(screen.getByRole('button', { name: /add labels/i }));

    expect(mockOnChange).toHaveBeenCalledWith({
      labels: '["urgent"]',
    });
  });

  it('should add component tag using Enter key', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    const componentsInput = screen.getByRole('textbox', { name: /components/i });
    await user.type(componentsInput, 'Backend{Enter}');

    expect(mockOnChange).toHaveBeenCalledWith({
      components: '[{"name":"Backend"}]',
    });
  });

  it('should add label tag using Enter key', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    const labelsInput = screen.getByRole('textbox', { name: /labels/i });
    await user.type(labelsInput, 'feature{Enter}');

    expect(mockOnChange).toHaveBeenCalledWith({
      labels: '["feature"]',
    });
  });

  it('should remove individual component tag when X button clicked', async () => {
    const user = userEvent.setup();

    const mappingsWithMultipleComponents = {
      components: '[{"name":"Frontend"},{"name":"Backend"}]',
    };

    render(
      <JiraFieldMappingsForm
        projectId={mockProjectId}
        mappings={mappingsWithMultipleComponents}
        onChange={mockOnChange}
      />
    );

    // Find and click the X button for Frontend tag
    const removeButton = screen.getByRole('button', { name: /remove frontend/i });
    await user.click(removeButton);

    // Should call onChange with only Backend remaining
    expect(mockOnChange).toHaveBeenCalledWith({
      components: '[{"name":"Backend"}]',
    });
  });

  it('should remove individual label tag when X button clicked', async () => {
    const user = userEvent.setup();

    const mappingsWithMultipleLabels = {
      labels: '["urgent","bug","feature"]',
    };

    render(
      <JiraFieldMappingsForm
        projectId={mockProjectId}
        mappings={mappingsWithMultipleLabels}
        onChange={mockOnChange}
      />
    );

    // Find and click the X button for bug tag
    const removeButton = screen.getByRole('button', { name: /remove bug/i });
    await user.click(removeButton);

    // Should call onChange with bug removed
    expect(mockOnChange).toHaveBeenCalledWith({
      labels: '["urgent","feature"]',
    });
  });

  it('should display existing field mappings', () => {
    const existingMappings = {
      assignee: '{"accountId":"acc-123"}',
      components: '["Backend"]',
      labels: '["bug"]',
      priority: '{"name": "High"}',
    };

    render(
      <JiraFieldMappingsForm
        projectId={mockProjectId}
        mappings={existingMappings}
        onChange={mockOnChange}
      />
    );

    // Check for tag badges
    expect(screen.getByTestId('tag-components-Backend')).toBeInTheDocument();
    expect(screen.getByTestId('tag-labels-bug')).toBeInTheDocument();

    // Check priority dropdown shows selected value
    expect(screen.getByRole('combobox', { name: /priority/i })).toHaveTextContent('High');
  });

  it('should show "Add Custom Field" button', () => {
    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    expect(screen.getByRole('button', { name: /add custom field/i })).toBeInTheDocument();
  });

  it('should add custom field when button clicked', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    const addButton = screen.getByRole('button', { name: /add custom field/i });
    await user.click(addButton);

    // Should show custom field input form
    expect(screen.getByPlaceholderText('customfield_10001')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('"Sprint 23"')).toBeInTheDocument();
  });

  it('should add custom field with ID and value', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    // Click add custom field
    await user.click(screen.getByRole('button', { name: /add custom field/i }));

    // Fill in custom field details
    const fieldIdInput = screen.getByPlaceholderText('customfield_10001');
    const fieldValueInput = screen.getByPlaceholderText('"Sprint 23"');

    await user.type(fieldIdInput, 'customfield_10050');
    await user.type(fieldValueInput, '"Sprint 1"');

    // Click add button
    const submitButton = screen.getByRole('button', { name: /^add$/i });
    await user.click(submitButton);

    expect(mockOnChange).toHaveBeenCalledWith({
      customfield_10050: '"Sprint 1"',
    });
  });

  it('should display existing custom fields', () => {
    const mappingsWithCustom = {
      assignee: '{"accountId":"acc-123"}',
      customfield_10050: '"Sprint 1"',
      customfield_10100: '{"value": "Epic ABC"}',
    };

    render(
      <JiraFieldMappingsForm
        projectId={mockProjectId}
        mappings={mappingsWithCustom}
        onChange={mockOnChange}
      />
    );

    // Custom field IDs are rendered as disabled inputs
    expect(screen.getByDisplayValue('customfield_10050')).toBeInTheDocument();
    expect(screen.getByDisplayValue('"Sprint 1"')).toBeInTheDocument();
    expect(screen.getByDisplayValue('customfield_10100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('{"value": "Epic ABC"}')).toBeInTheDocument();
  });

  it('should remove custom field when delete button clicked', async () => {
    const user = userEvent.setup();

    const mappingsWithCustom = {
      customfield_10050: '"Sprint 1"',
    };

    render(
      <JiraFieldMappingsForm
        projectId={mockProjectId}
        mappings={mappingsWithCustom}
        onChange={mockOnChange}
      />
    );

    // Find delete button for custom field (generic aria-label since it's dynamically rendered)
    const deleteButton = screen.getByRole('button', { name: /remove custom field/i });
    await user.click(deleteButton);

    expect(mockOnChange).toHaveBeenCalledWith(null);
  });

  it('should clear all fields when Clear All button clicked', async () => {
    const user = userEvent.setup();

    const existingMappings = {
      assignee: '{"accountId":"acc-123"}',
      components: '["Backend"]',
      customfield_10050: '"Sprint 1"',
    };

    render(
      <JiraFieldMappingsForm
        projectId={mockProjectId}
        mappings={existingMappings}
        onChange={mockOnChange}
      />
    );

    const clearButton = screen.getByTestId('clear-all-fields');
    await user.click(clearButton);

    expect(mockOnChange).toHaveBeenCalledWith(null);
  });

  it('should not add custom field with empty ID or value', async () => {
    const user = userEvent.setup();

    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    // Click add custom field
    await user.click(screen.getByRole('button', { name: /add custom field/i }));

    // Try to add without filling fields
    const submitButton = screen.getByRole('button', { name: /^add$/i });
    await user.click(submitButton);

    // Should not call onChange
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('should display inline help text for field information', () => {
    render(
      <JiraFieldMappingsForm projectId={mockProjectId} mappings={null} onChange={mockOnChange} />
    );

    // Check for help text section
    expect(screen.getByText('Field Information:')).toBeInTheDocument();
    expect(screen.getByText(/priority.*select from standard jira priorities/i)).toBeInTheDocument();
    expect(screen.getByText(/components\/labels.*add tags one at a time/i)).toBeInTheDocument();
  });
});
