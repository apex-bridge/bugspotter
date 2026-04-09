import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ProjectDataResidencyPage } from '../../pages/project-data-residency';
import { dataResidencyService } from '../../services/data-residency-service';
import { projectService } from '../../services/project-service';

// Mock services
vi.mock('../../services/data-residency-service');
vi.mock('../../services/project-service');
vi.mock('sonner');

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Mock useParams
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useParams: () => ({ projectId: 'test-project-123' }),
    useNavigate: () => mockNavigate,
  };
});

describe('ProjectDataResidencyPage', () => {
  let queryClient: QueryClient;

  const mockProject = {
    id: 'test-project-123',
    name: 'Test Project',
    created_at: '2024-01-01T00:00:00Z',
    report_count: 10,
  };

  const mockRegions = [
    {
      id: 'kz' as const,
      name: 'Kazakhstan',
      storageRegions: ['kz-almaty'],
      defaultStorageRegion: 'kz-almaty',
      allowCrossRegionBackup: false,
      allowCrossRegionProcessing: false,
      encryptionRequired: true,
    },
    {
      id: 'global' as const,
      name: 'Global (No Restrictions)',
      storageRegions: ['auto'],
      defaultStorageRegion: 'auto',
      allowCrossRegionBackup: true,
      allowCrossRegionProcessing: true,
      encryptionRequired: false,
    },
  ];

  const mockPolicyData = {
    projectId: 'test-project-123',
    policy: {
      region: 'global' as const,
      storageRegion: 'auto',
      allowCrossRegionBackup: true,
      allowCrossRegionProcessing: true,
      encryptionRequired: false,
      auditDataAccess: false,
    },
    storageAvailable: true,
    allowedRegions: ['auto'],
    presets: ['kz', 'rf', 'eu', 'us', 'global'],
  };

  const mockComplianceSummary = {
    projectId: 'test-project-123',
    isCompliant: true,
    policy: mockPolicyData.policy,
    storageAvailable: true,
    violations: {
      count: 0,
      recent: [],
    },
    auditEntries: {
      count: 5,
    },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(projectService.getById).mockResolvedValue(mockProject);
    vi.mocked(dataResidencyService.getRegions).mockResolvedValue(mockRegions);
    vi.mocked(dataResidencyService.getPolicy).mockResolvedValue(mockPolicyData);
    vi.mocked(dataResidencyService.getComplianceSummary).mockResolvedValue(mockComplianceSummary);
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ProjectDataResidencyPage />
        </BrowserRouter>
      </QueryClientProvider>
    );
  };

  it('should fetch project data on mount', async () => {
    renderComponent();

    await waitFor(() => {
      expect(projectService.getById).toHaveBeenCalledWith('test-project-123');
      expect(dataResidencyService.getRegions).toHaveBeenCalled();
      expect(dataResidencyService.getPolicy).toHaveBeenCalledWith('test-project-123');
      expect(dataResidencyService.getComplianceSummary).toHaveBeenCalledWith('test-project-123');
    });
  });

  it('should display project name', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  it('should display compliance metrics', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument(); // Violations count
      expect(screen.getByText('5')).toBeInTheDocument(); // Audit entries count
    });
  });

  it('should display violations when present', async () => {
    const summaryWithViolations = {
      ...mockComplianceSummary,
      isCompliant: false,
      violations: {
        count: 2,
        recent: [
          {
            id: 'violation-1',
            type: 'unauthorized_region_access',
            description: 'Attempted to access data from unauthorized region',
            blocked: true,
            createdAt: '2024-01-15T10:00:00Z',
          },
        ],
      },
    };

    vi.mocked(dataResidencyService.getComplianceSummary).mockResolvedValue(summaryWithViolations);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument(); // Violation count
      expect(screen.getByText('unauthorized_region_access')).toBeInTheDocument();
      expect(
        screen.getByText('Attempted to access data from unauthorized region')
      ).toBeInTheDocument();
    });
  });

  it('should display all available regions', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('pages.data_residency.regions.kz')).toBeInTheDocument();
      expect(screen.getByText('pages.data_residency.regions.global')).toBeInTheDocument();
    });
  });

  it('should update policy when region is changed and saved', async () => {
    const user = userEvent.setup();
    const updatedPolicy = {
      ...mockPolicyData,
      policy: {
        ...mockPolicyData.policy,
        region: 'kz' as const,
        storageRegion: 'kz-almaty',
      },
    };

    vi.mocked(dataResidencyService.updatePolicy).mockResolvedValue(updatedPolicy);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('pages.data_residency.regions.kz')).toBeInTheDocument();
    });

    // Select Kazakhstan region
    const kzButton = screen.getByRole('button', { name: /data_residency\.regions\.kz/ });
    await user.click(kzButton);

    // Find and click save button
    const saveButton = screen.getByRole('button', { name: /common.save_changes/ });
    await user.click(saveButton);

    await waitFor(() => {
      expect(dataResidencyService.updatePolicy).toHaveBeenCalledWith(
        'test-project-123',
        'kz',
        'kz-almaty'
      );
    });
  });

  it('should display current policy details', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('GLOBAL')).toBeInTheDocument();
      expect(screen.getByText('auto')).toBeInTheDocument();
    });
  });

  it('should handle navigation back to project', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /common.back_to_projects/ })).toBeInTheDocument();
    });

    const backButton = screen.getByRole('button', { name: /common.back_to_projects/ });
    await user.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith('/projects');
  });

  it('should show error state when policy fails to load', async () => {
    const error = new Error('Failed to load policy');
    vi.mocked(dataResidencyService.getPolicy).mockRejectedValue(error);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
