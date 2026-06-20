import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DedupRulesPage from '../../pages/dedup-rules';

// Regression: the back button used to navigate('/projects/:projectId') — a
// route that doesn't exist (there is no project-detail page), so the click was
// a silent no-op. It must return to the projects list like the sibling pages.

const mockNavigate = vi.fn();
const mockProjectId = '123e4567-e89b-12d3-a456-426614174000';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn().mockResolvedValue('en') },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../services/dedup-rules-service', () => ({
  dedupRulesService: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../hooks/use-dedup-rules', () => ({
  DEDUP_RULES_QUERY_KEY: 'dedupRules',
  useDedupRules: () => ({
    create: { mutate: vi.fn() },
    update: { mutate: vi.fn() },
    toggleEnabled: { mutate: vi.fn() },
    deleteRule: { mutate: vi.fn() },
  }),
}));

vi.mock('../../hooks/use-project-permissions', () => ({
  useProjectPermissions: () => ({ canManageIntegrations: true }),
}));

vi.mock('../../lib/api-client', () => ({
  handleApiError: (e: unknown) => (e instanceof Error ? e.message : 'Unknown error'),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <div data-testid="arrow-left-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
}));

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}
vi.mock('../../components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: ButtonProps) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

interface DivProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}
vi.mock('../../components/ui/card', () => ({
  Card: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
  CardContent: ({ children }: DivProps) => <div>{children}</div>,
}));
vi.mock('../../components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: DivProps) => <div>{children}</div>,
}));
vi.mock('../../components/dedup-rules/rule-card', () => ({ DedupRuleCard: () => null }));
vi.mock('../../components/dedup-rules/rule-form-dialog', () => ({
  DedupRuleFormDialog: () => null,
}));
vi.mock('../../components/dedup-rules/delete-dialog', () => ({
  DedupRuleDeleteDialog: () => null,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${mockProjectId}/dedup-rules`]}>
        <Routes>
          <Route path="/projects/:projectId/dedup-rules" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DedupRulesPage — back navigation', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('returns to the projects list (not a nonexistent project-detail route)', async () => {
    render(<DedupRulesPage />, { wrapper });

    const backButton = await screen.findByRole('button', {
      name: /dedupRules\.backToProject/i,
    });
    fireEvent.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith('/projects');
    // Guard the exact regression: never the unmatched /projects/:id route.
    expect(mockNavigate).not.toHaveBeenCalledWith(`/projects/${mockProjectId}`);
  });
});
