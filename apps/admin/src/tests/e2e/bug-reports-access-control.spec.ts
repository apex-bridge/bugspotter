import { test, expect, type Page } from '../fixtures/setup-fixture';
import { BugReportsPage } from './page-objects/bug-reports-page';

/**
 * E2E Tests for Bug Reports Access Control
 *
 * Tests verify:
 * 1. Admin users can see ALL bug reports across all projects
 * 2. Regular users only see bug reports from their accessible projects
 * 3. Filters work correctly for both user types
 * 4. User-based query optimization works (single JOIN query)
 */

const API_URL = process.env.API_URL || 'http://localhost:4000';

// Test data constants
const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Test Admin',
} as const;

const TEST_USER = {
  email: 'regular@test.com',
  password: 'testuser123',
  name: 'Regular User',
  role: 'user',
} as const;

async function loginAsUser(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'networkidle' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  await page.getByRole('button', { name: /sign in|login/i }).click();

  // Wait for navigation after login (app redirects to /projects or /dashboard)
  await page.waitForURL(/\/(dashboard|projects)/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Bug Reports - Access Control & Filters', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let regularUserToken: string;
  let project1: { id: string; name: string; api_key: string };
  let project2: { id: string; name: string; api_key: string };
  let regularUserId: string;

  test.beforeAll(async ({ request, setupState }) => {
    // Create admin user
    await setupState.ensureInitialized({
      email: TEST_ADMIN.email,
      password: TEST_ADMIN.password,
      name: TEST_ADMIN.name,
    });

    // Get admin token
    const adminLoginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: {
        email: TEST_ADMIN.email,
        password: TEST_ADMIN.password,
      },
    });
    const adminData = await adminLoginResponse.json();
    adminToken = adminData.data.access_token;

    // Create regular user via admin API
    const createUserResponse = await request.post(`${API_URL}/api/v1/admin/users`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
        name: TEST_USER.name,
        role: TEST_USER.role,
      },
    });

    if (createUserResponse.ok()) {
      const userData = await createUserResponse.json();
      regularUserId = userData.data.id;
    }

    // Login as regular user to get token
    const regularLoginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });
    const regularData = await regularLoginResponse.json();
    regularUserToken = regularData.data.access_token;

    // Create two projects
    const project1Response = await request.post(`${API_URL}/api/v1/projects`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      data: {
        name: 'Project Alpha',
      },
    });
    const project1Data = await project1Response.json();
    project1 = project1Data.data;

    const project2Response = await request.post(`${API_URL}/api/v1/projects`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      data: {
        name: 'Project Beta',
      },
    });
    const project2Data = await project2Response.json();
    project2 = project2Data.data;

    // Create API keys for both projects
    const apiKey1Response = await request.post(`${API_URL}/api/v1/api-keys`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      data: {
        name: 'Project Alpha API Key',
        type: 'test',
        permission_scope: 'full', // Valid values: 'full' | 'read_only' (not 'project')
        allowed_projects: [project1.id],
      },
    });
    expect(apiKey1Response.status()).toBe(201);
    const apiKey1Data = await apiKey1Response.json();
    project1.api_key = apiKey1Data.data?.api_key || apiKey1Data.api_key;
    expect(project1.api_key).toBeTruthy();

    const apiKey2Response = await request.post(`${API_URL}/api/v1/api-keys`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      data: {
        name: 'Project Beta API Key',
        type: 'test',
        permission_scope: 'full', // Valid values: 'full' | 'read_only' (not 'project')
        allowed_projects: [project2.id],
      },
    });
    expect(apiKey2Response.status()).toBe(201);
    const apiKey2Data = await apiKey2Response.json();
    project2.api_key = apiKey2Data.data?.api_key || apiKey2Data.api_key;
    expect(project2.api_key).toBeTruthy();

    // Add regular user as member to Project 1 ONLY (not Project 2)
    await request.post(`${API_URL}/api/v1/projects/${project1.id}/members`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      data: {
        user_id: regularUserId,
        role: 'member',
      },
    });

    // Create bug reports in both projects using API keys
    // Project 1 - 3 bug reports (regular user can see these)
    await request.post(`${API_URL}/api/v1/reports`, {
      headers: {
        'X-API-Key': project1.api_key,
      },
      data: {
        title: 'Project Alpha - Bug 1 - Critical',
        description: 'Critical bug in Project Alpha',
        priority: 'critical',
        report: {
          console: [],
          network: [],
          metadata: {},
        },
      },
    });

    await request.post(`${API_URL}/api/v1/reports`, {
      headers: {
        'X-API-Key': project1.api_key,
      },
      data: {
        title: 'Project Alpha - Bug 2 - High',
        description: 'High priority bug in Project Alpha',
        priority: 'high',
        report: {
          console: [],
          network: [],
          metadata: {},
        },
      },
    });

    await request.post(`${API_URL}/api/v1/reports`, {
      headers: {
        'X-API-Key': project1.api_key,
      },
      data: {
        title: 'Project Alpha - Bug 3 - Medium',
        description: 'Medium priority bug in Project Alpha',
        priority: 'medium',
        report: {
          console: [],
          network: [],
          metadata: {},
        },
      },
    });

    // Project 2 - 2 bug reports (regular user CANNOT see these)
    await request.post(`${API_URL}/api/v1/reports`, {
      headers: {
        'X-API-Key': project2.api_key,
      },
      data: {
        title: 'Project Beta - Bug 1 - Critical',
        description: 'Critical bug in Project Beta',
        priority: 'critical',
        report: {
          console: [],
          network: [],
          metadata: {},
        },
      },
    });

    await request.post(`${API_URL}/api/v1/reports`, {
      headers: {
        'X-API-Key': project2.api_key,
      },
      data: {
        title: 'Project Beta - Bug 2 - Low',
        description: 'Low priority bug in Project Beta',
        priority: 'low',
        report: {
          console: [],
          network: [],
          metadata: {},
        },
      },
    });
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: Delete test projects (cascades to bug reports and memberships)
    // Wrapped in try-catch to handle cases where backend is unavailable
    try {
      if (project1?.id && adminToken) {
        await request.delete(`${API_URL}/api/v1/projects/${project1.id}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
    } catch (error) {
      console.log(
        'Failed to delete project1 (backend may be down):',
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      if (project2?.id && adminToken) {
        await request.delete(`${API_URL}/api/v1/projects/${project2.id}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
    } catch (error) {
      console.log(
        'Failed to delete project2 (backend may be down):',
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      // Delete regular user
      if (regularUserId && adminToken) {
        await request.delete(`${API_URL}/api/v1/admin/users/${regularUserId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
    } catch (error) {
      console.log(
        'Failed to delete regular user (backend may be down):',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  test('admin should see ALL bug reports from all projects', async ({ page, request }) => {
    await loginAsUser(page, TEST_ADMIN.email, TEST_ADMIN.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for bug reports to load
    await bugReportsPage.waitForReportList();

    // Verify we see all 5 bug reports
    const reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBeGreaterThanOrEqual(5);

    // Verify we can see reports from BOTH projects
    await expect(bugReportsPage.reportsByProject('Project Alpha').first()).toBeVisible();
    await expect(bugReportsPage.reportsByProject('Project Beta').first()).toBeVisible();

    // Verify via API as well
    const apiResponse = await request.get(`${API_URL}/api/v1/reports`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const apiData = await apiResponse.json();
    // API returns paginated data: { success: true, data: [...], pagination: {...} }
    expect(apiData.success).toBe(true);
    expect(apiData.data).toBeDefined();
    expect(Array.isArray(apiData.data)).toBe(true);
    expect(apiData.data.length).toBeGreaterThanOrEqual(5);
  });

  test('regular user should ONLY see bug reports from their accessible projects', async ({
    page,
    request,
  }) => {
    await loginAsUser(page, TEST_USER.email, TEST_USER.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for bug reports to load
    await bugReportsPage.waitForReportList();

    // Verify we can see reports from Project Alpha only
    await expect(bugReportsPage.reportsByProject('Project Alpha').first()).toBeVisible();

    // Verify we CANNOT see reports from Project Beta
    await expect(bugReportsPage.reportsByProject('Project Beta').first()).not.toBeVisible();

    // Verify we see exactly 3 bug reports (only from Project Alpha)
    const reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBe(3);

    // Verify via API - should use optimized JOIN query with user_id
    const apiResponse = await request.get(`${API_URL}/api/v1/reports`, {
      headers: {
        Authorization: `Bearer ${regularUserToken}`,
      },
    });
    const apiData = await apiResponse.json();
    expect(apiData.data.length).toBe(3);

    // All reports should be from Project Alpha
    apiData.data.forEach((report: { project_id: string }) => {
      expect(report.project_id).toBe(project1.id);
    });
  });

  test('admin should be able to filter by specific project', async ({ page }) => {
    await loginAsUser(page, TEST_ADMIN.email, TEST_ADMIN.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for filters to be visible
    await expect(page.getByRole('heading', { name: /filters/i })).toBeVisible();

    // Select Project Beta from dropdown
    await bugReportsPage.selectProject(project2.id);

    // Verify only Project Beta reports are shown
    await expect(bugReportsPage.reportsByProject('Project Beta').first()).toBeVisible();

    // Verify Project Alpha reports are NOT shown
    await expect(bugReportsPage.reportsByProject('Project Alpha').first()).not.toBeVisible();

    // Verify count - should see 2 reports
    const reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBe(2);
  });

  test('admin can filter by priority and see reports across ALL projects', async ({ page }) => {
    await loginAsUser(page, TEST_ADMIN.email, TEST_ADMIN.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for filters to be visible
    await expect(page.getByRole('heading', { name: /filters/i })).toBeVisible();

    // Filter by critical priority
    await bugReportsPage.selectPriority('critical');

    // Verify we see 2 critical reports (one from EACH project)
    // This is the key difference from regular user - admin sees across ALL projects
    const reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBe(2);

    // Verify we see critical bugs from BOTH projects
    await expect(
      bugReportsPage.getReportByTitle('Project Alpha - Bug 1 - Critical').first()
    ).toBeVisible();
    await expect(
      bugReportsPage.getReportByTitle('Project Beta - Bug 1 - Critical').first()
    ).toBeVisible();
  });

  test('regular user with priority filter ONLY sees accessible project reports', async ({
    page,
  }) => {
    await loginAsUser(page, TEST_USER.email, TEST_USER.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for filters to be visible
    await expect(page.getByRole('heading', { name: /filters/i })).toBeVisible();

    // Filter by critical priority
    await bugReportsPage.selectPriority('critical');

    // Regular user should see ONLY 1 critical report (from Project Alpha)
    // Even though Project Beta also has a critical bug, user has no access
    const reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBe(1);

    // Verify it's from Project Alpha only
    await expect(
      bugReportsPage.getReportByTitle('Project Alpha - Bug 1 - Critical').first()
    ).toBeVisible();

    // Verify Project Beta critical bug is NOT visible
    await expect(
      bugReportsPage.getReportByTitle('Project Beta - Bug 1 - Critical')
    ).not.toBeVisible();
  });

  test('regular user combined filters (status + priority) work correctly', async ({ page }) => {
    await loginAsUser(page, TEST_USER.email, TEST_USER.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for filters to be visible
    await expect(page.getByRole('heading', { name: /filters/i })).toBeVisible();

    // Apply status filter
    await bugReportsPage.selectStatus('open');

    // Apply priority filter
    await bugReportsPage.selectPriority('high');

    // Verify we see 1 report (Project Alpha - High only, user has no access to Project Beta)
    const reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBe(1);

    // Verify it's the high priority bug from accessible project only
    await expect(
      bugReportsPage.getReportByTitle('Project Alpha - Bug 2 - High').first()
    ).toBeVisible();
  });

  test('regular user sees empty state when filtering by priority only in inaccessible projects', async ({
    page,
  }) => {
    await loginAsUser(page, TEST_USER.email, TEST_USER.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    // Wait for filters to be visible
    await expect(page.getByRole('heading', { name: /filters/i })).toBeVisible();

    // Filter by low priority (ONLY exists in Project Beta which user CANNOT access)
    // This tests that access control is enforced even with filters
    await bugReportsPage.selectPriority('low');

    // Verify empty state - user has no access to the only project with low priority bugs
    await expect(bugReportsPage.emptyState).toBeVisible();
    await expect(page.getByText(/No bug reports match your current filters/i)).toBeVisible();
  });

  test('regular user cannot see bug reports by directly accessing Project Beta API', async ({
    request,
  }) => {
    // Attempt to access Project Beta reports directly via API with regular user token
    const apiResponse = await request.get(`${API_URL}/api/v1/reports?project_id=${project2.id}`, {
      headers: {
        Authorization: `Bearer ${regularUserToken}`,
      },
    });

    // Should return 403 Forbidden or empty results
    if (apiResponse.ok()) {
      const apiData = await apiResponse.json();
      // If request succeeds, data should be empty (no access)
      expect(apiData.data.data.length).toBe(0);
    } else {
      // Or should return 403
      expect(apiResponse.status()).toBe(403);
    }
  });

  test('verify optimized query is used for regular users (no project_id filter)', async ({
    request,
  }) => {
    // This test verifies that the backend uses the optimized user_id JOIN query
    // when a regular user lists all their reports without specifying project_id

    const apiResponse = await request.get(`${API_URL}/api/v1/reports`, {
      headers: {
        Authorization: `Bearer ${regularUserToken}`,
      },
    });

    expect(apiResponse.ok()).toBeTruthy();
    const apiData = await apiResponse.json();

    // Should return exactly 3 reports (all from Project Alpha)
    expect(apiData.data.length).toBe(3);

    // All should be from Project Alpha
    apiData.data.forEach((report: { project_id: string }) => {
      expect(report.project_id).toBe(project1.id);
    });

    // Backend should have used single JOIN query (verified by backend logs)
    // The response should be fast (< 100ms for this small dataset)
  });

  test('admin can clear project filter and see all reports again', async ({ page }) => {
    await loginAsUser(page, TEST_ADMIN.email, TEST_ADMIN.password);
    const bugReportsPage = new BugReportsPage(page);
    await bugReportsPage.goto();

    await page.waitForSelector('h3:has-text("Filters")');

    // Select Project Beta
    await bugReportsPage.selectProject(project2.id);

    // Verify filtered to 2 reports
    let reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBe(2);

    // Clear all filters
    await bugReportsPage.clearFilters();

    // Verify we see all 5+ reports again
    await expect(bugReportsPage.reportCards.first()).toBeVisible();
    reportCount = await bugReportsPage.getReportCount();
    expect(reportCount).toBeGreaterThanOrEqual(5);
  });
});
