import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickSetupActions } from '../../components/onboarding/quick-setup-actions';

const navigateMock = vi.fn();
const onboardingStatusMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => onboardingStatusMock(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderInRouter() {
  return render(
    <MemoryRouter>
      <QuickSetupActions />
    </MemoryRouter>
  );
}

describe('QuickSetupActions', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    onboardingStatusMock.mockReset();
  });

  it('renders nothing when the empty-state condition is not met', () => {
    onboardingStatusMock.mockReturnValue({
      shouldShowQuickSetup: false,
      primaryProjectId: 'proj-1',
      canConfigure: true,
    });

    const { container } = renderInRouter();

    // No buttons, no label, no test id
    expect(container.firstChild).toBeNull();
  });

  it('renders both CTAs in the empty-state for an admin', () => {
    onboardingStatusMock.mockReturnValue({
      shouldShowQuickSetup: true,
      primaryProjectId: 'proj-1',
      canConfigure: true,
    });

    renderInRouter();

    expect(screen.getByTestId('quick-setup-actions')).toBeDefined();
    expect(screen.getByText('quickSetup.sdkSnippet')).toBeDefined();
    expect(screen.getByText('quickSetup.connectJira')).toBeDefined();
  });

  it('navigates to the Jira integration page on Connect Jira click', () => {
    onboardingStatusMock.mockReturnValue({
      shouldShowQuickSetup: true,
      primaryProjectId: 'proj-1',
      canConfigure: true,
    });

    renderInRouter();

    fireEvent.click(screen.getByText('quickSetup.connectJira'));

    expect(navigateMock).toHaveBeenCalledWith('/integrations/jira');
  });

  it('opens the SDK snippet dialog when SDK snippet is clicked', () => {
    onboardingStatusMock.mockReturnValue({
      shouldShowQuickSetup: true,
      primaryProjectId: 'proj-1',
      canConfigure: true,
    });

    renderInRouter();

    // Dialog content not in DOM until the button is clicked
    expect(screen.queryByText('quickSetup.snippetDialog.title')).toBeNull();

    fireEvent.click(screen.getByText('quickSetup.sdkSnippet'));

    expect(screen.getByText('quickSetup.snippetDialog.title')).toBeDefined();
  });
});
