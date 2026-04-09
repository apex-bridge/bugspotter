/**
 * E2E Tests — Projects Page
 * Tests project listing, filtering, sorting, org filter, and project creation.
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';
import { E2E_API_URL } from './config';

const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
};

test.describe('Projects Page', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  let project2Id: string;

  test.beforeAll(async ({ setupState, request }) => {
    await setupState.ensureInitialized(TEST_ADMIN);

    // Get admin token
    const loginResponse = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
      data: { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const data = await loginResponse.json();
    authToken = data.data.access_token;

    // Create two organizations
    const org1Response = await request.post(`${E2E_API_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: 'E2E Org Alpha', subdomain: `e2e-alpha-${Date.now()}` },
    });
    expect(org1Response.ok()).toBeTruthy();
    org1Id = (await org1Response.json()).data.id;

    const org2Response = await request.post(`${E2E_API_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: 'E2E Org Beta', subdomain: `e2e-beta-${Date.now()}` },
    });
    expect(org2Response.ok()).toBeTruthy();
    org2Id = (await org2Response.json()).data.id;

    // Create a project in each org
    const p1Response = await request.post(`${E2E_API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: 'Alpha Project', organization_id: org1Id },
    });
    expect(p1Response.ok()).toBeTruthy();
    project1Id = (await p1Response.json()).data.id;

    const p2Response = await request.post(`${E2E_API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: 'Beta Project', organization_id: org2Id },
    });
    expect(p2Response.ok()).toBeTruthy();
    project2Id = (await p2Response.json()).data.id;
  });

  test.afterAll(async ({ request }) => {
    if (!authToken) {
      return;
    }
    // Clean up: delete projects then orgs (use allSettled so one failure doesn't block others)
    await Promise.allSettled(
      [project1Id, project2Id].filter(Boolean).map((id) =>
        request.delete(`${E2E_API_URL}/api/v1/projects/${id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
      )
    );
    await Promise.allSettled(
      [org1Id, org2Id].filter(Boolean).map((id) =>
        request.delete(`${E2E_API_URL}/api/v1/organizations/${id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
      )
    );
  });

  test('should display projects page with search and sort', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    // Wait for page to load
    await expect(page.getByRole('heading', { name: /projects/i, level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Search input should be visible
    await expect(page.getByTestId('projects-search')).toBeVisible();

    // Sort buttons should be visible
    await expect(page.getByTestId('sort-by-name')).toBeVisible();
    await expect(page.getByTestId('sort-by-date')).toBeVisible();
    await expect(page.getByTestId('sort-by-reports')).toBeVisible();
  });

  test('should filter projects by search query', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    await expect(page.getByTestId('projects-search')).toBeVisible({ timeout: 10000 });

    // Search for "Alpha"
    await page.getByTestId('projects-search').fill('Alpha');

    // Should see Alpha Project but not Beta Project
    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Beta Project')).not.toBeVisible();

    // Clear search
    await page.getByTestId('projects-search').fill('');

    // Both should be visible again
    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Beta Project')).toBeVisible();
  });

  test('should show no results message for unmatched search', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    await expect(page.getByTestId('projects-search')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('projects-search').fill('zzz-nonexistent-project');

    await expect(page.getByTestId('projects-no-results')).toBeVisible({ timeout: 5000 });
  });

  test('should show organization filter when projects span multiple orgs', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    // Wait for projects to load
    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 10000 });

    // Org filter should be visible since we have projects in 2 orgs
    const orgFilter = page.getByTestId('projects-org-filter');
    await expect(orgFilter).toBeVisible({ timeout: 5000 });

    // Should have "All organizations" default option
    await expect(orgFilter.locator('option', { hasText: /all organizations/i })).toBeAttached();

    // Should have both org options
    await expect(orgFilter.locator('option', { hasText: 'E2E Org Alpha' })).toBeAttached();
    await expect(orgFilter.locator('option', { hasText: 'E2E Org Beta' })).toBeAttached();
  });

  test('should filter projects by organization', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 10000 });

    const orgFilter = page.getByTestId('projects-org-filter');
    await expect(orgFilter).toBeVisible({ timeout: 5000 });

    // Select Org Alpha
    await orgFilter.selectOption({ label: 'E2E Org Alpha' });

    // Only Alpha Project should be visible
    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Beta Project')).not.toBeVisible();

    // Select Org Beta
    await orgFilter.selectOption({ label: 'E2E Org Beta' });

    // Only Beta Project should be visible
    await expect(page.getByText('Beta Project')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Alpha Project')).not.toBeVisible();

    // Reset to All
    await orgFilter.selectOption({ value: '' });

    // Both should be visible
    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Beta Project')).toBeVisible();
  });

  test('should show org selector in create project form', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    // Open create form
    await page.getByTestId('new-project-button').click();

    // Create form should be visible
    await expect(page.getByTestId('create-project-form')).toBeVisible({ timeout: 5000 });

    // Org selector should be visible
    const orgSelect = page.getByTestId('project-org-select');
    await expect(orgSelect).toBeVisible();

    // Should have org options
    await expect(orgSelect.locator('option', { hasText: 'E2E Org Alpha' })).toBeAttached();
    await expect(orgSelect.locator('option', { hasText: 'E2E Org Beta' })).toBeAttached();
  });

  test('should create a project with org selected', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    // Open create form
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('create-project-form')).toBeVisible({ timeout: 5000 });

    // Select org and enter name (unique per run to avoid conflicts)
    const projectName = `E2E Created Project ${Date.now()}`;
    await page.getByTestId('project-org-select').selectOption({ label: 'E2E Org Alpha' });
    await page.getByTestId('project-name-input').fill(projectName);
    await page.getByTestId('create-project-submit').click();

    // Should see success and new project in list
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10000 });

    // Clean up: delete the created project via API
    const listResponse = await page.request.get(`${E2E_API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (listResponse.ok()) {
      const projects: { id: string; name: string }[] = (await listResponse.json()).data;
      const created = projects.find((p) => p.name === projectName);
      if (created) {
        await page.request.delete(`${E2E_API_URL}/api/v1/projects/${created.id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }
    }
  });

  test('should sort projects by name', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');

    await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 10000 });

    // Click Name sort button
    await page.getByTestId('sort-by-name').click();

    // Name button should be active (primary variant)
    const nameBtn = page.getByTestId('sort-by-name');
    await expect(nameBtn).toHaveAttribute('aria-pressed', 'true');

    // Get all project names in order
    const projectCards = page.locator('[data-testid^="project-name-"]');
    const names = await projectCards.allTextContents();

    // Should be sorted alphabetically (asc by default for name)
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedNames);

    // Click again to reverse
    await page.getByTestId('sort-by-name').click();
    const namesDesc = await projectCards.allTextContents();
    const sortedDesc = [...namesDesc].sort((a, b) => b.localeCompare(a));
    expect(namesDesc).toEqual(sortedDesc);
  });
});
