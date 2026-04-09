/**
 * Project Member Management E2E Tests
 * Tests the complete project member management flow including:
 * - Viewing project members
 * - Adding new members with different roles
 * - Updating member roles
 * - Removing members from projects
 * - Owner protections
 * - Permission enforcement
 */

import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_HOSTNAME } from './config';
import { test } from '../fixtures/setup-fixture';

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  const currentURL = page.url();

  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  await page.getByRole('button', { name: /sign in|login/i }).click();

  await page.waitForURL('/dashboard', { timeout: 10000 });
  await page.waitForLoadState('networkidle');
}

// Helper to create a test user
async function createTestUser(
  request: APIRequestContext,
  authToken: string,
  email: string,
  name: string
) {
  const API_URL = process.env.API_URL || 'http://localhost:4000';
  const response = await request.post(`${API_URL}/api/v1/admin/users`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    data: {
      email,
      name,
      password: 'testuser123',
      role: 'user',
    },
  });

  if (response.ok()) {
    const data = await response.json();
    return data.data;
  }
  return null;
}

test.describe('Project Member Management', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string | null = null;
  let testProject: { id: string; name: string };

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

      if (loginResponse.ok()) {
        const data = await loginResponse.json();
        authToken = data.data.access_token;
      }
    }

    // Ensure test project exists
    if (authToken && !testProject) {
      testProject = await setupState.ensureProjectExists(authToken);
    }

    await loginAsAdmin(page);
  });

  test('should validate required fields in add member form', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Open add member form
    await page
      .getByRole('button', { name: /add member/i })
      .first()
      .click();

    // Verify submit button is disabled when no user is selected
    const submitButton = page.getByRole('button', { name: /add member/i }).nth(1);
    await expect(submitButton).toBeDisabled();

    // Form should still be visible
    await expect(page.getByRole('heading', { name: /add team member/i })).toBeVisible();
  });

  test('should add a new member as admin', async ({ page, request }) => {
    // Create a unique test user for this test
    const testUser = await createTestUser(
      request,
      authToken!,
      `admin-test-${Date.now()}@bugspotter.io`,
      'Admin Test User'
    );

    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Open add member form
    await page
      .getByRole('button', { name: /add member/i })
      .first()
      .click();

    // Select user by value (user ID)
    const userSelect = page.getByLabel(/user/i);
    await userSelect.selectOption(testUser.id);

    // Select admin role
    const roleSelect = page.locator('#role-select');
    await roleSelect.selectOption('admin');

    // Submit form
    await page
      .getByRole('button', { name: /add member/i })
      .nth(1)
      .click();

    // Verify success message
    await expect(page.getByText(/member added successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify member appears in table
    const table = page.locator('table tbody');
    await expect(table.getByText('Admin Test User')).toBeVisible();
    await expect(table.getByText(testUser.email)).toBeVisible();

    // Verify admin badge (bg-red-100)
    await expect(table.locator('span.bg-red-100')).toBeVisible();
  });

  test('should add a new member as member role', async ({ page, request }) => {
    // Create a unique test user for this test
    const testUser = await createTestUser(
      request,
      authToken!,
      `member-test-${Date.now()}@bugspotter.io`,
      'Member Test User'
    );

    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Open add member form
    await page
      .getByRole('button', { name: /add member/i })
      .first()
      .click();

    // Select user by value (user ID)
    const userSelect = page.locator('#user-select');
    await userSelect.selectOption(testUser.id);

    // Select member role (should be default)
    const roleSelect = page.locator('#role-select');
    await expect(roleSelect).toHaveValue('member');

    // Submit form
    await page
      .getByRole('button', { name: /add member/i })
      .nth(1)
      .click();

    // Verify success message
    await expect(page.getByText(/member added successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify member appears in table
    const table = page.locator('table tbody');
    await expect(table.getByText('Member Test User')).toBeVisible();

    // Verify member badge (bg-blue-100)
    await expect(table.locator('span.bg-blue-100')).toBeVisible();
  });

  test('should prevent adding duplicate members', async ({ page, request }) => {
    // Create and add a test user to the project
    const testUser = await createTestUser(
      request,
      authToken!,
      `duplicate-test-${Date.now()}@bugspotter.io`,
      'Duplicate Test User'
    );

    // Add user to project via API
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    await request.post(`${API_URL}/api/v1/projects/${testProject.id}/members`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { user_id: testUser.id, role: 'member' },
    });

    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Verify user already exists in the list
    const table = page.locator('table tbody');
    await expect(table.getByText('Duplicate Test User')).toBeVisible();

    // Open add member form
    await page
      .getByRole('button', { name: /add member/i })
      .first()
      .click();

    // User select should not show this user anymore
    const userSelect = page.locator('#user-select');
    await userSelect.click();

    // Test user should not be in the dropdown (already a member)
    const options = page.locator('option');
    const optionTexts = await options.allTextContents();
    const hasTestUser = optionTexts.some((text) => text.includes(testUser.email));
    expect(hasTestUser).toBe(false);
  });

  test('should change member role from member to admin', async ({ page, request }) => {
    // Create and add a test user to the project as member
    const testUser = await createTestUser(
      request,
      authToken!,
      `role-change-1-${Date.now()}@bugspotter.io`,
      'Role Change Test User 1'
    );

    // Add user to project via API as member
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    await request.post(`${API_URL}/api/v1/projects/${testProject.id}/members`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { user_id: testUser.id, role: 'member' },
    });

    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Find user's row
    const rows = page.locator('table tbody tr');
    const testUserRow = rows.filter({ hasText: 'Role Change Test User 1' });
    await expect(testUserRow).toBeVisible();

    // Verify current role is Member (bg-blue-100)
    await expect(testUserRow.locator('span.bg-blue-100')).toBeVisible();

    // Click "Change Role" button
    const changeRoleButton = testUserRow.getByRole('button', { name: 'Change role from member' });
    await changeRoleButton.click();

    // Wait for role selector to replace the button
    const roleSelect = testUserRow.getByRole('combobox', { name: 'Select new role' });
    await roleSelect.waitFor({ state: 'visible' });

    // Change to admin
    await roleSelect.selectOption('admin');

    // Verify success message
    await expect(page.getByText(/role updated successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify role badge changed to Admin (bg-red-100)
    await expect(testUserRow.locator('span.bg-red-100')).toBeVisible();
  });

  test('should change member role from admin to viewer', async ({ page, request }) => {
    // Create and add a test user to the project as admin
    const testUser = await createTestUser(
      request,
      authToken!,
      `role-change-2-${Date.now()}@bugspotter.io`,
      'Role Change Test User 2'
    );

    // Add user to project via API as admin
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    await request.post(`${API_URL}/api/v1/projects/${testProject.id}/members`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { user_id: testUser.id, role: 'admin' },
    });

    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Find user's row (currently admin)
    const rows = page.locator('table tbody tr');
    const testUserRow = rows.filter({ hasText: 'Role Change Test User 2' });
    await expect(testUserRow).toBeVisible();

    // Verify current role is Admin (bg-red-100)
    await expect(testUserRow.locator('span.bg-red-100')).toBeVisible();

    // Click \"Change Role\" button
    await testUserRow.getByRole('button', { name: 'Change role from admin' }).click();

    // Wait for role selector to replace the button
    const roleSelect = testUserRow.getByRole('combobox', { name: 'Select new role' });
    await roleSelect.waitFor({ state: 'visible' });

    // Change to viewer
    await roleSelect.selectOption('viewer');

    // Verify success message
    await expect(page.getByText(/role updated successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify role badge changed to Viewer (bg-gray-100)
    await expect(testUserRow.locator('span.bg-gray-100')).toBeVisible();
  });

  test('should remove a member from project', async ({ page, request }) => {
    // Create and add a test user to the project
    const testUser = await createTestUser(
      request,
      authToken!,
      `remove-test-${Date.now()}@bugspotter.io`,
      'Remove Test User'
    );

    // Add user to project via API
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    await request.post(`${API_URL}/api/v1/projects/${testProject.id}/members`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { user_id: testUser.id, role: 'member' },
    });

    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Find user's row
    const rows = page.locator('table tbody tr');
    const testUserRow = rows.filter({ hasText: 'Remove Test User' });
    await expect(testUserRow).toBeVisible();

    // Click remove button
    await testUserRow.getByRole('button', { name: /remove.*from project/i }).click();

    // Wait for custom ConfirmDialog to appear
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText(/remove team member/i)).toBeVisible();
    await expect(confirmDialog.getByText(/remove test user/i)).toBeVisible();

    // Click the confirm button in the dialog
    await confirmDialog.getByRole('button', { name: /remove member/i }).click();

    // Verify success message
    await expect(page.getByText(/member removed successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify member no longer appears in table
    await expect(rows.filter({ hasText: 'Remove Test User' })).not.toBeVisible();
  });

  test('should not show remove button for project owner', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/members`, { waitUntil: 'networkidle' });

    // Find owner's row
    const rows = page.locator('table tbody tr');
    const ownerRow = rows.filter({ hasText: 'Admin User' });
    await expect(ownerRow).toBeVisible();

    // Verify owner badge (more specific selector to avoid matching "Project Owner" text)
    await expect(ownerRow.locator('span.bg-purple-100')).toBeVisible();

    // Verify "Project Owner" text is shown instead of action buttons
    await expect(ownerRow.getByText('Project Owner')).toBeVisible();

    // Verify no remove button exists
    await expect(ownerRow.getByRole('button', { name: /remove/i })).not.toBeVisible();

    // Verify no change role button exists
    await expect(ownerRow.getByRole('button', { name: /change role/i })).not.toBeVisible();
  });
});

test.describe('User Projects View', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string | null = null;
  let testProject: { id: string; name: string };
  let testUser: { id: string; email: string };

  test.beforeEach(async ({ page, setupState, request }) => {
    // Ensure admin user exists
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Admin User',
    });

    // Get auth token
    if (!authToken) {
      const API_URL = process.env.API_URL || 'http://localhost:4000';
      const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
        data: {
          email: 'admin@bugspotter.io',
          password: 'admin123',
        },
      });

      if (loginResponse.ok()) {
        const data = await loginResponse.json();
        authToken = data.data.access_token;
      }
    }

    // Ensure test project exists
    if (authToken && !testProject) {
      testProject = await setupState.ensureProjectExists(authToken);
    }

    // Create test user
    if (authToken && !testUser) {
      testUser = await createTestUser(
        request,
        authToken,
        'projectviewuser@bugspotter.io',
        'Project View User'
      );
    }

    await loginAsAdmin(page);
  });

  test('should show view projects button in users table', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'networkidle' });

    // Verify users table is visible
    const table = page.locator('table');
    await expect(table).toBeVisible();

    // Find first user row and verify view projects button exists
    const firstRow = table.locator('tbody tr').first();
    await expect(firstRow.getByRole('button').first()).toBeVisible();
  });

  test('should open user projects modal', async ({ page, request }) => {
    // First add the test user to a project
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    await request.post(`${API_URL}/api/v1/projects/${testProject.id}/members`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        user_id: testUser.id,
        role: 'member',
      },
    });

    await page.goto('/users', { waitUntil: 'networkidle' });

    // Find the test user's row
    const rows = page.locator('table tbody tr');
    const userRow = rows.filter({ hasText: 'projectviewuser@bugspotter.io' });

    // Click the view projects button (folder icon)
    await userRow.getByRole('button').first().click();

    // Verify modal appears
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^Projects -/i)).toBeVisible();
  });

  test('should display user projects in modal', async ({ page, request }) => {
    // Ensure test user is a member of the project
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    await request.post(`${API_URL}/api/v1/projects/${testProject.id}/members`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        user_id: testUser.id,
        role: 'admin',
      },
    });

    await page.goto('/users', { waitUntil: 'networkidle' });

    // Open user projects modal
    const rows = page.locator('table tbody tr');
    const userRow = rows.filter({ hasText: 'projectviewuser@bugspotter.io' });
    await userRow.getByRole('button').first().click();

    // Verify modal shows project
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(testProject.name)).toBeVisible();
    // Verify role is displayed (checking for any role text)
    await expect(dialog.getByText(/Member|Admin|Viewer|Owner/)).toBeVisible();
  });

  test('should close user projects modal', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'networkidle' });

    // Open modal
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.getByRole('button').first().click();

    // Verify modal is open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close modal using close button
    await dialog.getByRole('button', { name: /close/i }).click();

    // Verify modal is closed
    await expect(dialog).not.toBeVisible();
  });

  test('should display owner badge for owned projects', async ({ page }) => {
    // Admin user should be owner of test project
    await page.goto('/users', { waitUntil: 'networkidle' });

    // Find admin user's row
    const rows = page.locator('table tbody tr');
    const adminRow = rows.filter({ hasText: 'admin@bugspotter.io' });

    // Click view projects button
    await adminRow.getByRole('button').first().click();

    // Verify modal shows project with owner indicator (admin owns multiple projects, use first())
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(testProject.name)).toBeVisible();
    await expect(dialog.locator('p.text-sm:has-text("👑")').first()).toBeVisible();
  });
});
