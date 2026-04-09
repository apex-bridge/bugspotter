/**
 * Register Page Tests
 * Tests for user registration page component
 *
 * Note: Uses standard vitest assertions (not jest-dom matchers like toBeInTheDocument)
 * because @testing-library/jest-dom matchers have a known setup issue in this project.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import RegisterPage from '../../pages/register';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../components/language-switcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams],
  };
});

vi.mock('../../services/api', () => ({
  authService: {
    register: vi.fn(),
    getRegistrationStatus: vi.fn().mockResolvedValue({
      allowed: true,
      requireInvitation: false,
    }),
  },
  setupService: {
    getStatus: vi.fn(),
  },
  invitationService: {
    preview: vi.fn().mockRejectedValue(new Error('Not mocked')),
  },
}));

vi.mock('../../lib/api-client', () => ({
  handleApiError: vi.fn((error: Error) => error.message),
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({
    login: mockLogin,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService, setupService } from '../../services/api';
import { toast } from 'sonner';

const mockLogin = vi.fn();

function renderRegisterPage() {
  return render(
    <BrowserRouter>
      <RegisterPage />
    </BrowserRouter>
  );
}

/** Wait for the form to appear (setup check completed) */
async function waitForForm() {
  await waitFor(() => {
    expect(screen.getByText('auth.registerTitle')).toBeDefined();
  });
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: system is initialized
    vi.mocked(setupService.getStatus).mockResolvedValue({
      initialized: true,
      requiresSetup: false,
      setupMode: 'minimal' as const,
    });
  });

  describe('Setup check', () => {
    it('should redirect to /setup when system is not initialized', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: false,
        requiresSetup: true,
        setupMode: 'minimal' as const,
      });

      renderRegisterPage();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/setup');
      });
    });

    it('should show registration form when system is initialized', async () => {
      renderRegisterPage();

      await waitForForm();

      expect(screen.getByText('auth.registerDescription')).toBeDefined();
    });
  });

  describe('Form rendering', () => {
    it('should render all form fields', async () => {
      renderRegisterPage();

      await waitForForm();

      // Name field (optional)
      expect(screen.getByPlaceholderText('auth.fullNamePlaceholder')).toBeDefined();
      // Email field
      expect(screen.getByPlaceholderText('user@example.com')).toBeDefined();
      // Password fields (password + confirm)
      const passwordFields = screen.getAllByPlaceholderText('••••••••');
      expect(passwordFields).toHaveLength(2);
      // Submit button
      expect(screen.getByText('auth.registerButton')).toBeDefined();
    });

    it('should show "Sign in" link', async () => {
      renderRegisterPage();

      await waitForForm();

      expect(screen.getByText('auth.haveAccount')).toBeDefined();
      expect(screen.getByText('auth.signIn')).toBeDefined();
    });
  });

  describe('Password validation', () => {
    it('should show error when passwords do not match', async () => {
      renderRegisterPage();

      await waitForForm();

      const emailInput = screen.getByPlaceholderText('user@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'different456' } });

      const form = screen.getByText('auth.registerButton').closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('auth.passwordMismatch');
      });

      expect(authService.register).not.toHaveBeenCalled();
    });
  });

  describe('Successful registration', () => {
    it('should register and auto-login on success', async () => {
      const mockResponse = {
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-123',
          email: 'new@example.com',
          name: '',
          role: 'user' as const,
          created_at: '2025-01-01T00:00:00Z',
        },
      };

      vi.mocked(authService.register).mockResolvedValue(mockResponse);

      renderRegisterPage();

      await waitForForm();

      const emailInput = screen.getByPlaceholderText('user@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

      fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });

      const form = screen.getByText('auth.registerButton').closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(authService.register).toHaveBeenCalledWith(
          'new@example.com',
          'password123',
          undefined,
          undefined
        );
        expect(mockLogin).toHaveBeenCalledWith('test-token', '', mockResponse.user);
        expect(toast.success).toHaveBeenCalledWith('auth.registrationSuccess');
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });

    it('should include name when provided', async () => {
      vi.mocked(authService.register).mockResolvedValue({
        access_token: 'token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: { id: '1', email: 'a@b.com', name: 'Jane', role: 'user' as const, created_at: '' },
      });

      renderRegisterPage();

      await waitForForm();

      const nameInput = screen.getByPlaceholderText('auth.fullNamePlaceholder');
      const emailInput = screen.getByPlaceholderText('user@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

      fireEvent.change(nameInput, { target: { value: 'Jane Doe' } });
      fireEvent.change(emailInput, { target: { value: 'jane@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });

      const form = screen.getByText('auth.registerButton').closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(authService.register).toHaveBeenCalledWith(
          'jane@example.com',
          'password123',
          'Jane Doe',
          undefined
        );
      });
    });
  });

  describe('Error handling', () => {
    it('should show error toast on registration failure', async () => {
      vi.mocked(authService.register).mockRejectedValue(
        new Error('Registration is currently disabled')
      );

      renderRegisterPage();

      await waitForForm();

      const emailInput = screen.getByPlaceholderText('user@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });

      const form = screen.getByText('auth.registerButton').closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });

      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  describe('invite_token handling', () => {
    it('should pass invite_token to sign-in link', async () => {
      mockSearchParams.set('invite_token', 'test-invite-123');

      renderRegisterPage();

      await waitForForm();

      const signInLink = screen.getByText('auth.signIn');
      expect(signInLink.getAttribute('href')).toBe('/login?invite_token=test-invite-123');

      // Clean up
      mockSearchParams.delete('invite_token');
    });

    it('should navigate to my-organization after registration with invite_token', async () => {
      mockSearchParams.set('invite_token', 'invite-abc');

      vi.mocked(authService.register).mockResolvedValue({
        access_token: 'token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: { id: '1', email: 'a@b.com', name: '', role: 'user' as const, created_at: '' },
      });

      renderRegisterPage();

      await waitForForm();

      const emailInput = screen.getByPlaceholderText('user@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });

      const form = screen.getByText('auth.registerButton').closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/my-organization');
      });

      // Clean up
      mockSearchParams.delete('invite_token');
    });
  });
});
