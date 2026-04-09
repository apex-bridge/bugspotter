import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProjectIntegrationsPage from '../../pages/project-integrations';

// Declare mocks before using them in vi.mock
const mockNavigate = vi.fn();
const mockProjectId = '123e4567-e89b-12d3-a456-426614174000';
const mockListIntegrations = vi.fn();

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params) {
        let result = key;
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, String(v));
        });
        return result;
      }
      return key;
    },
    i18n: { changeLanguage: vi.fn().mockResolvedValue('en') },
  }),
}));

// Mock react-router-dom's useNavigate only
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock project service
vi.mock('../../services/api', () => ({
  projectService: {
    listIntegrations: () => mockListIntegrations(),
  },
}));

// Mock api-client
vi.mock('../../lib/api-client', () => ({
  handleApiError: (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  },
}));

// Mock project permissions hook (avoids AuthProvider dependency)
vi.mock('../../hooks/use-project-permissions', () => ({
  useProjectPermissions: () => ({
    canManageIntegrations: true,
    canManageMembers: true,
    canEditProject: true,
    canDeleteProject: true,
    canDeleteReports: true,
    canUpload: true,
    canView: true,
    isSystemAdmin: true,
    isLoading: false,
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <div data-testid="arrow-left-icon" />,
  Settings2: () => <div data-testid="settings2-icon" />,
  Wrench: () => <div data-testid="wrench-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
}));

// Mock UI components
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  variant?: string;
  size?: string;
  className?: string;
  disabled?: boolean;
}

vi.mock('../../components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: ButtonProps) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

vi.mock('../../components/ui/card', () => ({
  Card: ({ children, ...props }: CardProps) => <div {...props}>{children}</div>,
  CardContent: ({ children }: CardProps) => <div>{children}</div>,
  CardDescription: ({ children }: CardProps) => <div>{children}</div>,
  CardHeader: ({ children }: CardProps) => <div>{children}</div>,
  CardTitle: ({ children }: CardProps) => <h2>{children}</h2>,
}));

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  variant?: string;
}

vi.mock('../../components/ui/badge', () => ({
  Badge: ({ children, ...props }: BadgeProps) => <span {...props}>{children}</span>,
}));

interface DropdownMenuProps {
  children?: React.ReactNode;
}

vi.mock('../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: DropdownMenuProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: DropdownMenuProps) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: DropdownMenuProps & { onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: DropdownMenuProps) => <div>{children}</div>,
}));

vi.mock('../../components/integrations/add-integration-dropdown', () => ({
  AddIntegrationDropdown: () => <div data-testid="add-integration-dropdown" />,
}));

// Helper to create test wrapper with query client and router
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${mockProjectId}/integrations`]}>
          <Routes>
            <Route path="/projects/:projectId/integrations" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('ProjectIntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  describe('Component Rendering', () => {
    it('should show error message when projectId is missing', () => {
      // Create a wrapper with a route that doesn't provide projectId
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });

      const WrapperWithoutProjectId = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/projects/integrations']}>
            <Routes>
              <Route path="/projects/integrations" element={children} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );

      render(<ProjectIntegrationsPage />, {
        wrapper: WrapperWithoutProjectId,
      });

      // Verify error message is displayed
      expect(screen.getByText('integrations.missingProjectId')).toBeInTheDocument();
    });

    it('should render integrations list when data loads', async () => {
      mockListIntegrations.mockResolvedValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira integration',
          enabled: true,
          config: { projectKey: 'TEST' },
          hasRules: true,
        },
      ]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for integrations to load
      await screen.findByRole('heading', { name: /jira/i });
      expect(
        screen.getByRole('button', { name: /integrations\.manageIntegrationRules/i })
      ).toBeInTheDocument();
    });

    it('should render configure button for all configured integrations', async () => {
      mockListIntegrations.mockResolvedValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira integration',
          enabled: true,
          config: { projectKey: 'TEST' },
          hasRules: true,
        },
        {
          platform: 'slack',
          name: 'Slack',
          description: 'Slack integration',
          enabled: true,
          config: { webhookUrl: 'https://hooks.slack.com' },
          hasRules: false,
        },
      ]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for integrations to load
      await screen.findByRole('heading', { name: /jira/i });
      await screen.findByRole('heading', { name: /slack/i });

      // Verify both configure buttons are visible (one per integration)
      const configureButtons = screen.getAllByRole('button', {
        name: /integrations\.configureIntegration/i,
      });
      expect(configureButtons).toHaveLength(2);
    });

    it('should only show Manage Rules button for integrations with hasRules=true', async () => {
      mockListIntegrations.mockResolvedValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira integration',
          enabled: true,
          config: { projectKey: 'TEST' },
          hasRules: true,
        },
        {
          platform: 'slack',
          name: 'Slack',
          description: 'Slack integration',
          enabled: true,
          config: { webhookUrl: 'https://hooks.slack.com' },
          hasRules: false,
        },
      ]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for integrations to load
      await screen.findByRole('heading', { name: /jira/i });
      await screen.findByRole('heading', { name: /slack/i });

      // Manage Rules should only be visible for Jira (only one button with this label)
      const manageRulesButtons = screen.queryAllByRole('button', {
        name: /integrations\.manageIntegrationRules/i,
      });
      expect(manageRulesButtons).toHaveLength(1);
    });

    it('should show error message when integration list fails to load', async () => {
      mockListIntegrations.mockRejectedValue(new Error('Failed to fetch integrations'));

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for error title
      await screen.findByText(/integrations\.unableToLoadIntegrationsTitle/i);
    });
  });

  describe('Button Visibility', () => {
    it('should have ARIA labels on manage rules button', async () => {
      mockListIntegrations.mockResolvedValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira integration',
          enabled: true,
          config: { projectKey: 'TEST' },
          hasRules: true,
        },
      ]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for integrations to load
      await screen.findByRole('heading', { name: /jira/i });

      // Verify accessible name exists
      expect(
        screen.getByRole('button', { name: /integrations\.manageIntegrationRules/i })
      ).toBeInTheDocument();
    });

    it('should have ARIA labels on configure button', async () => {
      mockListIntegrations.mockResolvedValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira integration',
          enabled: true,
          config: { projectKey: 'TEST' },
          hasRules: true,
        },
      ]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for integrations to load
      await screen.findByRole('heading', { name: /jira/i });

      // Verify accessible name exists
      expect(
        screen.getByRole('button', { name: /integrations\.configureIntegration/i })
      ).toBeInTheDocument();
    });

    it('should have ARIA label on back button in error state', async () => {
      mockListIntegrations.mockRejectedValue(new Error('Failed to fetch'));

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for error state
      await screen.findByText(/integrations\.unableToLoadIntegrationsTitle/i);

      // Verify back button in error card is present
      const backButton = screen.getByRole('button', {
        name: /integrations\.backToProjectsButton/i,
      });
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should display integrations after loading completes', async () => {
      mockListIntegrations.mockResolvedValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira integration',
          enabled: true,
          config: { projectKey: 'TEST' },
          hasRules: true,
        },
      ]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Initially loading, then integrations appear
      await screen.findByRole('heading', { name: /jira/i });
      expect(
        screen.getByRole('button', { name: /integrations\.manageIntegrationRules/i })
      ).toBeInTheDocument();
    });

    it('should handle empty integration list', async () => {
      mockListIntegrations.mockResolvedValue([]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for component to finish loading
      // Should render but show empty state
      expect(mockListIntegrations).toHaveBeenCalled();
    });
  });

  describe('Integration Service Calls', () => {
    it('should call listIntegrations service when component mounts', async () => {
      mockListIntegrations.mockResolvedValue([]);

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      expect(mockListIntegrations).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const errorMessage = 'Network error';
      mockListIntegrations.mockRejectedValue(new Error(errorMessage));

      render(<ProjectIntegrationsPage />, {
        wrapper: createWrapper(),
      });

      // Wait for error to appear
      await screen.findByText(/integrations\.unableToLoadIntegrationsTitle/i);
      expect(
        screen.getByRole('button', { name: /integrations\.backToProjectsButton/i })
      ).toBeInTheDocument();
    });
  });
});
