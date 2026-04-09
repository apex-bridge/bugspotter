import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionDenied } from '../../components/permission-denied';

describe('PermissionDenied', () => {
  it('should render with resource and default action', () => {
    render(<PermissionDenied resource="integration_rules" />);

    expect(screen.getByText('Permission Denied')).toBeInTheDocument();
    expect(
      screen.getByText(/You don't have permission to access integration_rules/)
    ).toBeInTheDocument();
    expect(screen.getByText('Required permission: access integration_rules')).toBeInTheDocument();
  });

  it('should render with custom action', () => {
    render(<PermissionDenied resource="integration_rules" action="create" />);

    expect(
      screen.getByText(/You don't have permission to create integration_rules/)
    ).toBeInTheDocument();
    expect(screen.getByText('Required permission: create integration_rules')).toBeInTheDocument();
  });

  it('should render with custom message', () => {
    const customMessage = 'Custom error message for testing';
    render(<PermissionDenied resource="integration_rules" message={customMessage} />);

    expect(screen.getByText(customMessage)).toBeInTheDocument();
    expect(screen.getByText('Required permission: access integration_rules')).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(<PermissionDenied resource="integration_rules" action="delete" />);

    // Warning icon should be aria-hidden
    const icon = document.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');

    // Should have descriptive heading
    expect(screen.getByRole('heading', { name: 'Permission Denied' })).toBeInTheDocument();
  });

  it('should display yellow warning styling', () => {
    const { container } = render(<PermissionDenied resource="integration_rules" />);

    // Card should have yellow border classes
    const card = container.querySelector('.border-yellow-200');
    expect(card).toBeInTheDocument();
  });

  it('should show AlertTriangle icon', () => {
    const { container } = render(<PermissionDenied resource="integration_rules" />);

    // Should have icon element
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-yellow-600');
  });

  it('should handle all CRUD actions', () => {
    const actions = ['create', 'read', 'update', 'delete'];

    actions.forEach((action) => {
      const { unmount } = render(<PermissionDenied resource="integration_rules" action={action} />);

      expect(
        screen.getByText(new RegExp(`You don't have permission to ${action} integration_rules`))
      ).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`Required permission: ${action} integration_rules`))
      ).toBeInTheDocument();

      unmount();
    });
  });

  it('should render contact administrator message', () => {
    render(<PermissionDenied resource="integration_rules" />);

    expect(
      screen.getByText(/Please contact your administrator to request access/)
    ).toBeInTheDocument();
  });
});
