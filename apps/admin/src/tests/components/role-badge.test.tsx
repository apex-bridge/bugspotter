import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleBadge } from '../../components/organizations/role-badge';

describe('RoleBadge', () => {
  it('renders the role text', () => {
    render(<RoleBadge role="admin" />);
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it.each([
    ['owner', 'bg-purple-100'],
    ['admin', 'bg-red-100'],
    ['member', 'bg-green-100'],
  ] as const)('applies correct color for %s role', (role, expectedClass) => {
    render(<RoleBadge role={role} />);
    expect(screen.getByTestId(`role-badge-${role}`)).toHaveClass(expectedClass);
  });

  it('has accessible aria-label', () => {
    render(<RoleBadge role="owner" />);
    expect(screen.getByLabelText('Member role: owner')).toBeInTheDocument();
  });
});
