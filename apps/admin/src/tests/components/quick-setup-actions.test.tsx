import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickSetupActions } from '../../components/onboarding/quick-setup-actions';
import type { OnboardingState } from '../../hooks/use-onboarding-status';

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

const baseState: OnboardingState = {
  canConfigure: true,
  hasProject: true,
  primaryProjectId: 'proj-1',
  integrationCount: 0,
  bugReportCount: 0,
};

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

  it('renders nothing when the user cannot configure (member/viewer)', () => {
    onboardingStatusMock.mockReturnValue({ ...baseState, canConfigure: false });
    const { container } = renderInRouter();
    expect(container.firstChild).toBeNull();
  });

  it('renders both CTAs in the empty-state for an admin', () => {
    onboardingStatusMock.mockReturnValue(baseState);
    renderInRouter();
    expect(screen.getByTestId('quick-setup-actions')).toBeDefined();
    expect(screen.getByTestId('quick-setup-sdk-snippet')).toBeDefined();
    expect(screen.getByTestId('quick-setup-connect-jira')).toBeDefined();
  });

  it('hides only the SDK CTA once any bug report has come in', () => {
    onboardingStatusMock.mockReturnValue({ ...baseState, bugReportCount: 1 });
    renderInRouter();
    expect(screen.queryByTestId('quick-setup-sdk-snippet')).toBeNull();
    expect(screen.getByTestId('quick-setup-connect-jira')).toBeDefined();
  });

  it('hides only the Connect Jira CTA once an integration is configured', () => {
    onboardingStatusMock.mockReturnValue({ ...baseState, integrationCount: 1 });
    renderInRouter();
    expect(screen.queryByTestId('quick-setup-connect-jira')).toBeNull();
    expect(screen.getByTestId('quick-setup-sdk-snippet')).toBeDefined();
  });

  it('renders nothing once both signals have moved past zero', () => {
    onboardingStatusMock.mockReturnValue({
      ...baseState,
      integrationCount: 1,
      bugReportCount: 1,
    });
    const { container } = renderInRouter();
    expect(container.firstChild).toBeNull();
  });

  it('navigates to the Jira integration page on Connect Jira click', () => {
    onboardingStatusMock.mockReturnValue(baseState);
    renderInRouter();
    fireEvent.click(screen.getByTestId('quick-setup-connect-jira'));
    expect(navigateMock).toHaveBeenCalledWith('/integrations/jira');
  });

  it('opens the SDK snippet dialog when the SDK CTA is clicked', () => {
    onboardingStatusMock.mockReturnValue(baseState);
    renderInRouter();
    expect(screen.queryByText('quickSetup.snippetDialog.title')).toBeNull();
    fireEvent.click(screen.getByTestId('quick-setup-sdk-snippet'));
    expect(screen.getByText('quickSetup.snippetDialog.title')).toBeDefined();
  });
});
