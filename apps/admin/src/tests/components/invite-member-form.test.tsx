import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteMemberForm } from '../../components/organizations/invite-member-form';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('InviteMemberForm', () => {
  let onSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSubmit = vi.fn().mockResolvedValue(undefined);
  });

  it('should render all form fields', () => {
    render(<InviteMemberForm onSubmit={onSubmit} />);

    expect(screen.getByLabelText('organizations.invitations.email')).toBeDefined();
    expect(screen.getByLabelText('common.role')).toBeDefined();
    expect(screen.getByLabelText('organizations.invitations.emailLanguage')).toBeDefined();
  });

  it('should submit with email, role, and locale', async () => {
    render(<InviteMemberForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('organizations.invitations.email'), {
      target: { value: 'test@example.com' },
    });

    const form = screen
      .getByRole('button', { name: /organizations.invitations.send/i })
      .closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('test@example.com', 'member', 'en');
    });
  });

  it('should reset all fields after successful submission', async () => {
    render(<InviteMemberForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText('organizations.invitations.email') as HTMLInputElement;
    const roleSelect = screen.getByLabelText('common.role') as HTMLSelectElement;
    const localeSelect = screen.getByLabelText(
      'organizations.invitations.emailLanguage'
    ) as HTMLSelectElement;

    // Change all fields
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(roleSelect, { target: { value: 'admin' } });
    fireEvent.change(localeSelect, { target: { value: 'kk' } });

    expect(emailInput.value).toBe('test@example.com');
    expect(roleSelect.value).toBe('admin');
    expect(localeSelect.value).toBe('kk');

    // Submit
    const form = screen
      .getByRole('button', { name: /organizations.invitations.send/i })
      .closest('form')!;
    fireEvent.submit(form);

    // All fields should reset
    await waitFor(() => {
      expect(emailInput.value).toBe('');
      expect(roleSelect.value).toBe('member');
      expect(localeSelect.value).toBe('en');
    });
  });

  it('should disable submit button when email is empty', () => {
    render(<InviteMemberForm onSubmit={onSubmit} />);

    const button = screen.getByRole('button', { name: /organizations.invitations.send/i });
    expect(button).toBeDisabled();
  });

  it('should disable submit button when isLoading is true', () => {
    render(<InviteMemberForm onSubmit={onSubmit} isLoading />);

    const button = screen.getByRole('button', { name: /organizations.invitations.send/i });
    expect(button).toBeDisabled();
  });
});
