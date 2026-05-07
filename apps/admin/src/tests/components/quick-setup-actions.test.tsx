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
};

const SDK_DISMISSED_KEY = 'bugspotter:quick-setup:sdk-dismissed';

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
    window.localStorage.clear();
  });

  // ---- Visibility contract -------------------------------------------------
  // SDK snippet  : canConfigure && hasProject && !dismissed
  //                  (manual dismiss because we can't auto-detect SDK install
  //                   — bug reports may come from the Chrome extension)
  // Connect Jira : canConfigure && hasProject && integrationCount === 0
  //                  (auto-hides once a Jira integration exists)

  it('hides both CTAs when the user cannot configure (member/viewer)', () => {
    onboardingStatusMock.mockReturnValue({ ...baseState, canConfigure: false });
    const { container } = renderInRouter();
    expect(container.firstChild).toBeNull();
  });

  it('hides both CTAs when the org has no project yet', () => {
    onboardingStatusMock.mockReturnValue({ ...baseState, hasProject: false });
    const { container } = renderInRouter();
    expect(container.firstChild).toBeNull();
  });

  it('renders both CTAs in the empty state for an admin with a project', () => {
    onboardingStatusMock.mockReturnValue(baseState);
    renderInRouter();
    expect(screen.getByTestId('quick-setup-actions')).toBeDefined();
    expect(screen.getByTestId('quick-setup-sdk-snippet')).toBeDefined();
    expect(screen.getByTestId('quick-setup-connect-jira')).toBeDefined();
  });

  it('hides only the Connect Jira CTA once an integration is configured', () => {
    onboardingStatusMock.mockReturnValue({ ...baseState, integrationCount: 1 });
    renderInRouter();
    expect(screen.queryByTestId('quick-setup-connect-jira')).toBeNull();
    expect(screen.getByTestId('quick-setup-sdk-snippet')).toBeDefined();
  });

  // ---- Dismiss behaviour ---------------------------------------------------

  it('hides the SDK CTA on dismiss click and persists the choice to localStorage', () => {
    onboardingStatusMock.mockReturnValue(baseState);
    renderInRouter();

    expect(screen.getByTestId('quick-setup-sdk-snippet')).toBeDefined();
    fireEvent.click(screen.getByTestId('quick-setup-sdk-snippet-dismiss'));

    expect(screen.queryByTestId('quick-setup-sdk-snippet')).toBeNull();
    expect(window.localStorage.getItem(SDK_DISMISSED_KEY)).toBe('1');
    // Jira CTA should still be there since dismiss is per-action.
    expect(screen.getByTestId('quick-setup-connect-jira')).toBeDefined();
  });

  it('honours an existing dismiss flag from localStorage at mount', () => {
    window.localStorage.setItem(SDK_DISMISSED_KEY, '1');
    onboardingStatusMock.mockReturnValue(baseState);
    renderInRouter();

    expect(screen.queryByTestId('quick-setup-sdk-snippet')).toBeNull();
    expect(screen.getByTestId('quick-setup-connect-jira')).toBeDefined();
  });

  it('hides the entire row when SDK is dismissed AND a Jira integration exists', () => {
    window.localStorage.setItem(SDK_DISMISSED_KEY, '1');
    onboardingStatusMock.mockReturnValue({ ...baseState, integrationCount: 1 });
    const { container } = renderInRouter();
    expect(container.firstChild).toBeNull();
  });

  // ---- Click behaviour -----------------------------------------------------

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
