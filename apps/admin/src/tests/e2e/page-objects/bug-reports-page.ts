import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for Bug Reports page E2E tests
 *
 * Encapsulates selectors and common interactions for the bug reports page.
 * Uses accessible selectors and data-testid attributes for robustness.
 */
export class BugReportsPage {
  readonly page: Page;

  // Main containers
  readonly reportListContainer: Locator;
  readonly reportCards: Locator;
  readonly emptyState: Locator;
  readonly loadingSpinner: Locator;

  // Filters
  readonly projectFilter: Locator;
  readonly statusFilter: Locator;
  readonly priorityFilter: Locator;
  readonly clearFiltersButton: Locator;

  // Pagination
  readonly previousButton: Locator;
  readonly nextButton: Locator;
  readonly pageInfo: Locator;

  constructor(page: Page) {
    this.page = page;

    // Main containers using data-testid
    this.reportListContainer = page.locator('[data-testid="bug-report-list"]');
    this.reportCards = this.reportListContainer.locator('[data-testid="bug-report-card"]');
    this.emptyState = page.getByRole('heading', { name: /No Bug Reports/i });
    this.loadingSpinner = page.locator('.animate-spin');

    // Filters using accessible selectors
    this.projectFilter = page.getByRole('combobox', { name: /project/i });
    this.statusFilter = page.getByRole('combobox', { name: /status/i });
    this.priorityFilter = page.getByRole('combobox', { name: /priority/i });
    this.clearFiltersButton = page.getByRole('button', { name: /Clear All/i });

    // Pagination
    this.previousButton = page.getByRole('button', { name: /Previous/i });
    this.nextButton = page.getByRole('button', { name: /Next/i });
    this.pageInfo = page.locator('text=/Page \\d+ of \\d+/');
  }

  /**
   * Navigate to bug reports page and wait for content to load
   */
  async goto() {
    await this.page.goto('/bug-reports');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get report cards filtered by project name
   */
  reportsByProject(projectName: string): Locator {
    return this.reportCards.filter({ hasText: projectName });
  }

  /**
   * Get report cards filtered by priority
   */
  reportsByPriority(priority: string): Locator {
    return this.reportCards.filter({ hasText: new RegExp(priority, 'i') });
  }

  /**
   * Get report cards filtered by status
   */
  reportsByStatus(status: string): Locator {
    return this.reportCards.filter({ hasText: new RegExp(status, 'i') });
  }

  /**
   * Get a specific report card by title
   */
  getReportByTitle(title: string): Locator {
    return this.reportCards.filter({ hasText: title });
  }

  /**
   * Select a project from the filter dropdown
   * @param projectId - The project ID to select
   */
  async selectProject(projectId: string) {
    await this.projectFilter.waitFor({ state: 'visible' });

    const responsePromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );

    await this.projectFilter.selectOption(projectId);
    await responsePromise;
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Select a status from the filter dropdown
   */
  async selectStatus(status: string) {
    await this.statusFilter.waitFor({ state: 'visible' });

    const responsePromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );

    await this.statusFilter.selectOption(status);
    await responsePromise;
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Select a priority from the filter dropdown
   */
  async selectPriority(priority: string) {
    await this.priorityFilter.waitFor({ state: 'visible' });

    const responsePromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );

    await this.priorityFilter.selectOption(priority);
    await responsePromise;
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clear all filters
   */
  async clearFilters() {
    await this.clearFiltersButton.waitFor({ state: 'visible', timeout: 5000 });

    const responsePromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );

    await this.clearFiltersButton.click();
    await responsePromise;
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get count of all report cards
   */
  async getReportCount(): Promise<number> {
    return await this.reportCards.count();
  }

  /**
   * Get count of reports for a specific project
   */
  async getProjectReportCount(projectName: string): Promise<number> {
    return await this.reportsByProject(projectName).count();
  }

  /**
   * Wait for report list to be visible
   */
  async waitForReportList(timeout = 20000) {
    await this.reportListContainer.waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if empty state is visible
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return await this.emptyState.isVisible();
  }

  /**
   * Check if a specific report is visible
   */
  async isReportVisible(title: string): Promise<boolean> {
    return await this.getReportByTitle(title).first().isVisible();
  }

  /**
   * Navigate to next page
   */
  async goToNextPage() {
    const responsePromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );

    await this.nextButton.click();
    await responsePromise;
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to previous page
   */
  async goToPreviousPage() {
    const responsePromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );

    await this.previousButton.click();
    await responsePromise;
    await this.page.waitForLoadState('networkidle');
  }
}
