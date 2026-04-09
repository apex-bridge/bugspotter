/**
 * Project Data Residency E2E Tests
 * Tests the complete data residency configuration flow including:
 * - Viewing data residency policy
 * - Changing data residency regions
 * - Updating storage regions
 * - Compliance status display
 * - Navigation to/from data residency page
 */

import { expect } from '@playwright/test';
import { test } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';

interface TestProject {
  id: string;
  name: string;
}

test.describe('Project Data Residency', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string | null = null;
  let testProject: TestProject | null = null;

  test.beforeEach(async ({ page, setupState, request }) => {
    // Ensure admin user exists
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Admin User',
    });

    // Get auth token if not cached
    if (!authToken) {
      const API_URL = process.env.API_URL || 'http://localhost:4000';
      const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
        data: {
          email: 'admin@bugspotter.io',
          password: 'admin123',
        },
      });

      if (!loginResponse.ok()) {
        const errorText = await loginResponse.text();
        throw new Error(`Failed to login as admin: ${loginResponse.status()} - ${errorText}`);
      }

      const data = await loginResponse.json();
      authToken = data.data.access_token;
    }

    // Ensure test project exists
    if (authToken && !testProject) {
      testProject = await setupState.ensureProjectExists(authToken);
    }

    // Verify required test data is available
    if (!authToken || !testProject) {
      throw new Error(
        `Test setup incomplete: authToken=${!!authToken}, testProject=${!!testProject}`
      );
    }

    await loginAsAdmin(page);
  });

  test('should navigate to data residency page from projects page', async ({ page }) => {
    await page.goto('/projects', { waitUntil: 'networkidle' });

    // Find the Data Residency button for the test project
    const projectCard = page.locator(`[data-testid="project-card-${testProject!.id}"]`);
    await expect(projectCard).toBeVisible();

    // Click the Data Residency button
    const dataResidencyButton = projectCard.getByRole('button', { name: /data residency/i });
    await expect(dataResidencyButton).toBeVisible();
    await dataResidencyButton.click();

    // Wait for navigation
    await page.waitForURL(`/projects/${testProject!.id}/data-residency`, { timeout: 10000 });

    // Verify we're on the data residency page
    await expect(page.getByTestId('data-residency-heading')).toBeVisible();
  });

  test('should display current data residency policy', async ({ page }) => {
    await page.goto(`/projects/${testProject!.id}/data-residency`, { waitUntil: 'networkidle' });

    // Check that the page loaded successfully
    await expect(page.getByTestId('data-residency-heading')).toBeVisible();

    // Check that project name is displayed
    await expect(page.getByText(testProject!.name)).toBeVisible();

    // Check that current policy is displayed (should default to global) - use first() to avoid strict mode violation
    await expect(page.getByText(/GLOBAL|global/i).first()).toBeVisible();
  });

  test('should navigate back to projects page', async ({ page }) => {
    await page.goto(`/projects/${testProject!.id}/data-residency`, { waitUntil: 'networkidle' });

    // Click the back button
    const backButton = page.getByRole('button', { name: /back to projects/i });
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Verify we're back on the projects list page
    await page.waitForURL('/projects', { timeout: 10000 });
  });

  test('should display available data residency regions', async ({ page }) => {
    await page.goto(`/projects/${testProject!.id}/data-residency`, { waitUntil: 'networkidle' });

    // Wait for regions to load by checking for a region button
    await page.getByTestId('region-card-global').waitFor({ state: 'visible', timeout: 10000 });

    // Verify all expected regions are visible using test-ids
    const regionIds = ['kz', 'rf', 'eu', 'us', 'global'];

    for (const regionId of regionIds) {
      const regionButton = page.getByTestId(`region-card-${regionId}`);
      await expect(regionButton).toBeVisible({ timeout: 5000 });
    }
  });

  // NOTE: Skipped - e2e environment doesn't have regional storage configured
  // To enable: set STORAGE_KZ_ALMATY_ENDPOINT/BUCKET or STORAGE_EU_CENTRAL_1_ENDPOINT/BUCKET
  test.skip('should change data residency region and save', async ({ page }) => {
    await page.goto(`/projects/${testProject!.id}/data-residency`, { waitUntil: 'networkidle' });

    // Wait for the page to fully load
    await page.getByTestId('region-card-global').waitFor({ state: 'visible', timeout: 10000 });

    // Find and click a different region (Kazakhstan - should be configured in e2e)
    const kzButton = page.getByTestId('region-card-kz');
    await kzButton.click();

    // Wait for the Save Changes button to become enabled
    const saveButton = page.getByRole('button', { name: /save changes/i });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });

    // Click save
    await saveButton.click();

    // Wait for success toast/message
    await page.waitForSelector('text=/updated|success/i', { timeout: 10000 });

    // Verify the KZ region button shows as selected (has bg-blue-50 class)
    const kzButtonAfterSave = page.getByTestId('region-card-kz');
    await expect(kzButtonAfterSave).toHaveClass(/bg-blue-50/, { timeout: 5000 });
  });

  test('should show save button disabled when no changes', async ({ page }) => {
    await page.goto(`/projects/${testProject!.id}/data-residency`, { waitUntil: 'networkidle' });

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // The save button should initially be disabled (no changes)
    const saveButton = page.getByRole('button', { name: /save changes/i });
    await expect(saveButton).toBeDisabled({ timeout: 10000 });
  });

  // NOTE: Skipped - e2e environment doesn't have compliance status data
  // Backend API likely doesn't return compliance metrics without proper configuration
  test.skip('should display compliance metrics', async ({ page }) => {
    await page.goto(`/projects/${testProject!.id}/data-residency`, { waitUntil: 'networkidle' });

    // Wait for compliance status card to load
    const complianceHeading = page.getByTestId('compliance-status-heading');
    await expect(complianceHeading).toBeVisible({ timeout: 10000 });

    // Get the compliance status card/section
    const complianceSection = complianceHeading.locator('..').locator('..');

    // Check for violations metric within compliance section
    const violationsMetric = complianceSection.getByText(/violations.*24h/i);
    await expect(violationsMetric).toBeVisible({ timeout: 5000 });

    // Check for audit entries metric within compliance section
    const auditEntriesMetric = complianceSection.getByText(/audit entries.*24h/i);
    await expect(auditEntriesMetric).toBeVisible({ timeout: 5000 });
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Navigate to a non-existent project
    await page.goto('/projects/non-existent-project-id/data-residency');

    // Should show error state or redirect
    await page.waitForSelector('text=/error|not found|invalid/i', { timeout: 10000 });
  });
});
