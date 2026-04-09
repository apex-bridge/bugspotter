import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MembersTable } from '../../components/organizations/members-table';
import type { OrganizationMember } from '../../types/organization';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const MEMBERS: OrganizationMember[] = [
  {
    id: '1',
    organization_id: 'org-1',
    user_id: 'user-1',
    role: 'owner',
    user_email: 'owner@example.com',
    user_name: 'Alice',
    created_at: '2025-06-01T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
  },
  {
    id: '2',
    organization_id: 'org-1',
    user_id: 'user-2',
    role: 'admin',
    user_email: 'admin@example.com',
    user_name: null,
    created_at: '2025-07-15T00:00:00Z',
    updated_at: '2025-07-15T00:00:00Z',
  },
  {
    id: '3',
    organization_id: 'org-1',
    user_id: 'user-3',
    role: 'member',
    user_email: 'member@example.com',
    user_name: 'Charlie',
    created_at: '2025-08-20T00:00:00Z',
    updated_at: '2025-08-20T00:00:00Z',
  },
];

describe('MembersTable', () => {
  it('shows empty state when no members', () => {
    render(<MembersTable members={[]} />);
    expect(screen.getByText('organizations.noMembers')).toBeInTheDocument();
  });

  it('renders all member rows', () => {
    render(<MembersTable members={MEMBERS} />);
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
  });

  it('shows user name or dash for null', () => {
    render(<MembersTable members={MEMBERS} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('renders role badges for each member', () => {
    render(<MembersTable members={MEMBERS} />);
    expect(screen.getByTestId('role-badge-owner')).toBeInTheDocument();
    expect(screen.getByTestId('role-badge-admin')).toBeInTheDocument();
    expect(screen.getByTestId('role-badge-member')).toBeInTheDocument();
  });

  it('formats dates as YYYY-MM-DD', () => {
    render(<MembersTable members={MEMBERS} />);
    expect(screen.getByText('2025-06-01')).toBeInTheDocument();
    expect(screen.getByText('2025-07-15')).toBeInTheDocument();
    expect(screen.getByText('2025-08-20')).toBeInTheDocument();
  });

  it('hides actions column when onRemove is not provided', () => {
    render(<MembersTable members={MEMBERS} />);
    expect(screen.queryByText('common.actions')).not.toBeInTheDocument();
    expect(screen.queryByTitle('common.delete')).not.toBeInTheDocument();
  });

  it('shows actions column when onRemove is provided', () => {
    render(<MembersTable members={MEMBERS} onRemove={vi.fn()} />);
    expect(screen.getByText('common.actions')).toBeInTheDocument();
  });

  it('shows delete button for non-owner members only', () => {
    render(<MembersTable members={MEMBERS} onRemove={vi.fn()} />);
    const deleteButtons = screen.getAllByTitle('common.delete');
    // admin + member get buttons, owner does not
    expect(deleteButtons).toHaveLength(2);
  });

  it('calls onRemove with user_id when delete is clicked', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<MembersTable members={MEMBERS} onRemove={onRemove} />);

    const deleteButtons = screen.getAllByTitle('common.delete');
    await user.click(deleteButtons[0]);

    expect(onRemove).toHaveBeenCalledWith('user-2');
  });
});
