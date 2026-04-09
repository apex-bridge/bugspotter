import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { RuleCard } from '../../components/integrations/rule-card';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { IntegrationRule } from '../../types';

describe('RuleCard', () => {
  const mockRule: IntegrationRule = {
    id: 'rule-1',
    project_id: 'project-1',
    integration_id: 'integration-1',
    name: 'Critical Bugs Rule',
    enabled: true,
    priority: 1,
    auto_create: true,
    filters: [
      {
        field: 'priority',
        operator: 'equals',
        value: 'critical',
        case_sensitive: false,
      },
    ],
    throttle: {
      max_per_hour: 10,
      max_per_day: 50,
      group_by: 'user',
      digest_mode: false,
      digest_interval_minutes: 30,
    },
    field_mappings: null,
    description_template: null,
    attachment_config: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  const defaultProps = {
    rule: mockRule,
    onToggleEnabled: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onExportJson: vi.fn(),
    onCopyJson: vi.fn(),
  };

  // Helper to render with TooltipProvider
  const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
  };

  it('should render rule information', () => {
    renderWithTooltip(<RuleCard {...defaultProps} />);

    expect(screen.getByText('Critical Bugs Rule')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Auto-create')).toBeInTheDocument();
    expect(screen.getByText('Order: 1')).toBeInTheDocument();
    expect(screen.getByText(/1 filter/)).toBeInTheDocument();
  });

  it('should call onToggleEnabled when toggle button is clicked', async () => {
    const user = userEvent.setup();
    const onToggleEnabled = vi.fn();

    renderWithTooltip(<RuleCard {...defaultProps} onToggleEnabled={onToggleEnabled} />);

    const toggleButton = screen.getByRole('button', { name: /disable rule/i });
    await user.click(toggleButton);

    expect(onToggleEnabled).toHaveBeenCalledWith('rule-1', true);
  });

  it('should call onCopy when copy button is clicked', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();

    renderWithTooltip(<RuleCard {...defaultProps} onCopy={onCopy} />);

    const copyButton = screen.getByRole('button', { name: /copy to another project/i });
    await user.click(copyButton);

    expect(onCopy).toHaveBeenCalledWith(mockRule);
  });

  it('should call onExportJson when export button is clicked', async () => {
    const user = userEvent.setup();
    const onExportJson = vi.fn();

    renderWithTooltip(<RuleCard {...defaultProps} onExportJson={onExportJson} />);

    // Open dropdown menu
    const exportTrigger = screen.getByRole('button', { name: /export options/i });
    await user.click(exportTrigger);

    // Click download option
    const downloadOption = screen.getByRole('menuitem', { name: /download json file/i });
    await user.click(downloadOption);

    expect(onExportJson).toHaveBeenCalledWith(mockRule);
  });

  it('should call onCopyJson when copy to clipboard button is clicked', async () => {
    const user = userEvent.setup();
    const onCopyJson = vi.fn();

    renderWithTooltip(<RuleCard {...defaultProps} onCopyJson={onCopyJson} />);

    // Open dropdown menu
    const exportTrigger = screen.getByRole('button', { name: /export options/i });
    await user.click(exportTrigger);

    // Click copy to clipboard option
    const copyOption = screen.getByRole('menuitem', { name: /copy to clipboard/i });
    await user.click(copyOption);

    expect(onCopyJson).toHaveBeenCalledWith(mockRule);
  });

  it('should call onEdit when edit button is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    renderWithTooltip(<RuleCard {...defaultProps} onEdit={onEdit} />);

    const editButton = screen.getByRole('button', { name: /edit rule/i });
    await user.click(editButton);

    expect(onEdit).toHaveBeenCalledWith(mockRule);
  });

  it('should call onDelete when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    renderWithTooltip(<RuleCard {...defaultProps} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: /delete rule/i });
    await user.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith('rule-1');
  });

  it('should display disabled badge when rule is disabled', () => {
    const disabledRule = { ...mockRule, enabled: false };

    renderWithTooltip(<RuleCard {...defaultProps} rule={disabledRule} />);

    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('should display filters information', () => {
    renderWithTooltip(<RuleCard {...defaultProps} />);

    expect(screen.getByText(/filters \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('priority')).toBeInTheDocument();
    expect(screen.getByText(/equals/i)).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('should display throttling information when throttle is configured', () => {
    renderWithTooltip(<RuleCard {...defaultProps} />);

    expect(screen.getByText('Throttling:')).toBeInTheDocument();
    expect(screen.getByText(/max 10 tickets per hour/i)).toBeInTheDocument();
    expect(screen.getByText(/max 50 tickets per day/i)).toBeInTheDocument();
    expect(screen.getByText(/grouped by user/i)).toBeInTheDocument();
  });

  it('should not display throttling section when throttle is null', () => {
    const ruleWithoutThrottle = { ...mockRule, throttle: null };

    renderWithTooltip(<RuleCard {...defaultProps} rule={ruleWithoutThrottle} />);

    expect(screen.queryByText('Throttling:')).not.toBeInTheDocument();
  });

  it('should display digest mode information when enabled', () => {
    const ruleWithDigest = {
      ...mockRule,
      throttle: {
        ...mockRule.throttle!,
        digest_mode: true,
        digest_interval_minutes: 30,
      },
    };

    renderWithTooltip(<RuleCard {...defaultProps} rule={ruleWithDigest} />);

    expect(screen.getByText(/digest mode enabled \(every 30 minutes\)/i)).toBeInTheDocument();
  });

  it('should display case sensitive indicator on filters', () => {
    const ruleWithCaseSensitive: IntegrationRule = {
      ...mockRule,
      filters: [
        {
          field: 'error_message' as const,
          operator: 'contains' as const,
          value: 'Error',
          case_sensitive: true,
        },
      ],
    };

    renderWithTooltip(<RuleCard {...defaultProps} rule={ruleWithCaseSensitive} />);

    expect(screen.getByText(/\(case sensitive\)/i)).toBeInTheDocument();
  });

  it('should handle array values in filters', () => {
    const ruleWithArrayFilter: IntegrationRule = {
      ...mockRule,
      filters: [
        {
          field: 'status' as const,
          operator: 'in' as const,
          value: ['open', 'in_progress'],
          case_sensitive: false,
        },
      ],
    };

    renderWithTooltip(<RuleCard {...defaultProps} rule={ruleWithArrayFilter} />);

    expect(screen.getByText('open, in_progress')).toBeInTheDocument();
  });

  it('should toggle filters visibility when collapse button is clicked', async () => {
    const user = userEvent.setup();

    renderWithTooltip(<RuleCard {...defaultProps} />);

    // Filters should be visible by default
    expect(screen.getByText('priority')).toBeInTheDocument();

    // Click collapse button
    const collapseButton = screen.getByRole('button', { name: /filters \(1\)/i });
    await user.click(collapseButton);

    // Filters should be hidden
    expect(screen.queryByText('priority')).not.toBeInTheDocument();

    // Click again to expand
    await user.click(collapseButton);

    // Filters should be visible again
    expect(screen.getByText('priority')).toBeInTheDocument();
  });

  it('should render both export options in dropdown menu', async () => {
    const user = userEvent.setup();

    renderWithTooltip(<RuleCard {...defaultProps} />);

    // Open dropdown menu
    const exportTrigger = screen.getByRole('button', { name: /export options/i });
    await user.click(exportTrigger);

    // Verify both options are present
    expect(screen.getByRole('menuitem', { name: /copy to clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /download json file/i })).toBeInTheDocument();
  });

  it('should have proper accessibility attributes on filter collapse button', () => {
    renderWithTooltip(<RuleCard {...defaultProps} />);

    const collapseButton = screen.getByRole('button', { name: /filters \(1\)/i });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(collapseButton).toHaveAttribute('aria-controls', 'filter-list');
  });

  describe('readOnly mode', () => {
    it('should disable toggle, copy, and delete buttons but keep view/edit enabled when readOnly is true', () => {
      renderWithTooltip(<RuleCard {...defaultProps} readOnly />);

      expect(screen.getByRole('button', { name: /disable rule/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /view rule/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /copy to another project/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /delete rule/i })).toBeDisabled();
    });

    it('should still show export dropdown when readOnly is true', async () => {
      const user = userEvent.setup();
      renderWithTooltip(<RuleCard {...defaultProps} readOnly />);

      const exportTrigger = screen.getByRole('button', { name: /export options/i });
      expect(exportTrigger).toBeInTheDocument();

      await user.click(exportTrigger);
      expect(screen.getByRole('menuitem', { name: /copy to clipboard/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /download json file/i })).toBeInTheDocument();
    });

    it('should still show rule information when readOnly is true', () => {
      renderWithTooltip(<RuleCard {...defaultProps} readOnly />);

      expect(screen.getByText('Critical Bugs Rule')).toBeInTheDocument();
      expect(screen.getByText('Enabled')).toBeInTheDocument();
      expect(screen.getByText(/1 filter/)).toBeInTheDocument();
    });
  });
});
