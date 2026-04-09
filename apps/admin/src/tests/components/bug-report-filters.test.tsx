import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BugReportFilters } from '../../components/bug-reports/bug-report-filters';
import type { BugReportFilters as Filters, Project } from '../../types';

describe('BugReportFilters', () => {
  const mockProjects: Project[] = [
    {
      id: 'project-1',
      name: 'Project Alpha',
      created_at: '2024-01-01T00:00:00Z',
      report_count: 10,
    },
    {
      id: 'project-2',
      name: 'Project Beta',
      created_at: '2024-01-02T00:00:00Z',
      report_count: 5,
    },
  ];

  it('renders all filter controls', () => {
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByLabelText(/project/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/priority/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it('displays project options', () => {
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    const projectSelect = screen.getByLabelText(/project/i) as HTMLSelectElement;
    expect(projectSelect.options).toHaveLength(3); // "All Projects" + 2 projects
    expect(projectSelect.options[1].textContent).toBe('Project Alpha');
    expect(projectSelect.options[2].textContent).toBe('Project Beta');
  });

  it('calls onFiltersChange when project filter changes', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    const projectSelect = screen.getByLabelText(/project/i);
    await user.selectOptions(projectSelect, 'project-1');

    expect(onFiltersChange).toHaveBeenCalledWith({ project_id: 'project-1' });
  });

  it('calls onFiltersChange when status filter changes', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    const statusSelect = screen.getByLabelText(/status/i);
    await user.selectOptions(statusSelect, 'open');

    expect(onFiltersChange).toHaveBeenCalledWith({ status: 'open' });
  });

  it('calls onFiltersChange when priority filter changes', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    const prioritySelect = screen.getByLabelText(/priority/i);
    await user.selectOptions(prioritySelect, 'high');

    expect(onFiltersChange).toHaveBeenCalledWith({ priority: 'high' });
  });

  it('calls onFiltersChange when date filters change', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    const fromDateInput = screen.getByLabelText(/from date/i);
    await user.type(fromDateInput, '2024-01-01');

    expect(onFiltersChange).toHaveBeenCalledWith({ created_after: '2024-01-01' });
  });

  it('shows "Clear All" button when filters are active', () => {
    const onFiltersChange = vi.fn();
    const filters: Filters = { status: 'open', priority: 'high' };
    render(
      <BugReportFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        projects={mockProjects}
      />
    );

    expect(screen.getByText(/clear all/i)).toBeInTheDocument();
  });

  it('hides "Clear All" button when no filters are active', () => {
    const onFiltersChange = vi.fn();
    render(
      <BugReportFilters filters={{}} onFiltersChange={onFiltersChange} projects={mockProjects} />
    );

    expect(screen.queryByText(/clear all/i)).not.toBeInTheDocument();
  });

  it('clears all filters when "Clear All" is clicked', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filters: Filters = { status: 'open', priority: 'high', project_id: 'project-1' };
    render(
      <BugReportFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        projects={mockProjects}
      />
    );

    const clearButton = screen.getByText(/clear all/i);
    await user.click(clearButton);

    expect(onFiltersChange).toHaveBeenCalledWith({});
  });

  it('displays current filter values', () => {
    const onFiltersChange = vi.fn();
    const filters: Filters = {
      project_id: 'project-1',
      status: 'open',
      priority: 'high',
      created_after: '2024-01-01',
      created_before: '2024-12-31',
    };
    render(
      <BugReportFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        projects={mockProjects}
      />
    );

    expect(screen.getByLabelText(/project/i)).toHaveValue('project-1');
    expect(screen.getByLabelText(/status/i)).toHaveValue('open');
    expect(screen.getByLabelText(/priority/i)).toHaveValue('high');
    expect(screen.getByLabelText(/from date/i)).toHaveValue('2024-01-01');
    expect(screen.getByLabelText(/to date/i)).toHaveValue('2024-12-31');
  });
});
