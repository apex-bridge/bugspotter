/**
 * Setup Flow E2E Tests - Comprehensive Coverage
 * Tests both initialized and uninitialized states using test fixtures
 */

import { test, expect } from '../fixtures/setup-fixture';
import { E2E_BASE_URL, E2E_API_URL } from './config';

test.describe('Setup Flow - Uninitialized System', () => {
  test.beforeEach(async ({ setupState }) => {
    // Ensure system is uninitialized for these tests
    await setupState.ensureUninitialized();
  });

  test('should show setup wizard when system not initialized', async ({ page, setupState }) => {
    const isInitialized = await setupState.checkStatus();
    expect(isInitialized).toBe(false);

    await page.goto('/', { waitUntil: 'networkidle' });

    // Should redirect to /setup
    await expect(page).toHaveURL(/\/setup/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /setup/i })).toBeVisible();
  });

  test('should return initialized=false when database has no users', async ({ setupState }) => {
    // Verify database is empty (no users)
    await setupState.ensureUninitialized();

    // Call setup status endpoint directly on backend (bypass Vite proxy)
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    const statusResponse = await fetch(`${apiUrl}/api/v1/setup/status`);
    expect(statusResponse.ok).toBe(true);

    const body = await statusResponse.json();
    expect(body.success).toBe(true);

    // IMPORTANT: This test verifies the backend's isSystemInitialized() function
    // If you see this test fail with initialized=true despite no users in database,
    // it means the backend is connected to a different database than the testcontainer.
    // Solution: Ensure backend at localhost:4000 is connected to the testcontainer DATABASE_URL
    expect(body.data.initialized).toBe(false);
    expect(body.data.requiresSetup).toBe(true);
  });

  test('should redirect to /setup when API returns initialized=false', async ({
    page,
    setupState,
    context,
  }) => {
    // Ensure database has no users
    await setupState.ensureUninitialized();

    // Intercept API calls and route them to the E2E backend on port 4000
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const newUrl = url.replace(`${E2E_BASE_URL}/api`, `${E2E_API_URL}/api`);

      const postData = route.request().postDataBuffer();
      const response = await context.request.fetch(newUrl, {
        method: route.request().method(),
        headers: route.request().headers(),
        data: postData || undefined,
      });

      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: await response.body(),
      });
    });

    // Visit root - AuthContext will call setupService.getStatus()
    await page.goto(`${E2E_BASE_URL}/`, { waitUntil: 'networkidle', timeout: 60000 });

    // Frontend should detect uninitialized system and redirect to /setup
    // If this fails and redirects to /login instead, it means the backend
    // is returning initialized=true despite having no users (the production bug)
    await expect(page).toHaveURL(/\/setup/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /setup/i })).toBeVisible();

    // Verify we're NOT at login page (would indicate the production bug)
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should display environment defaults in full setup mode', async ({
    page,
    setupState,
    request,
  }) => {
    await setupState.ensureUninitialized();

    // Get setup status with defaults
    const statusResponse = await request.get(`${E2E_API_URL}/api/v1/setup/status`);
    const status = await statusResponse.json();

    // Only test in full mode
    if (status.data?.setupMode !== 'full') {
      test.skip();
    }

    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Navigate to storage step (only exists in full mode)
    await page.getByRole('button', { name: /continue|next/i }).click();
    await page.getByRole('button', { name: /continue|next/i }).click();

    if (status.data?.defaults) {
      // Should show environment defaults banner
      await expect(page.getByText(/environment|configuration loaded/i)).toBeVisible({
        timeout: 5000,
      });

      // Fields should be pre-filled
      if (status.data.defaults.storage_bucket) {
        const bucketInput = page.getByLabel(/bucket/i);
        await expect(bucketInput).toHaveValue(status.data.defaults.storage_bucket);
      }
    }
  });

  test('should show info banner in minimal setup mode', async ({ page, setupState, request }) => {
    await setupState.ensureUninitialized();

    // Get setup status
    const statusResponse = await request.get(`${E2E_API_URL}/api/v1/setup/status`);
    const status = await statusResponse.json();

    // Only test in minimal mode
    if (status.data?.setupMode !== 'minimal') {
      test.skip();
    }

    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Should show info banner about env vars (check for partial text that exists)
    // Check for info banner with minimal setup message
    await expect(page.getByText(/create your admin account to complete setup/i)).toBeVisible();

    // Should show "Complete Setup" button instead of "Continue"
    await expect(page.getByRole('button', { name: /complete setup/i })).toBeVisible();

    // Should not show Continue button (no additional steps)
    await expect(page.getByRole('button', { name: /^continue$/i })).not.toBeVisible();
  });

  test('should complete minimal setup with only admin credentials', async ({
    page,
    setupState,
    request,
  }) => {
    await setupState.ensureUninitialized();

    // Get setup mode
    const statusResponse = await request.get(`${E2E_API_URL}/api/v1/setup/status`);
    const status = await statusResponse.json();

    if (status.data?.setupMode !== 'minimal') {
      test.skip();
    }

    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Fill admin credentials
    await page.getByLabel(/name/i).fill('Test Admin');
    await page.getByLabel(/email/i).fill('test-admin@example.com');
    await page.getByLabel(/password/i).fill('TestPassword123!');

    // Submit (no additional steps in minimal mode)
    await page.getByRole('button', { name: /complete setup/i }).click();

    // Should redirect to dashboard and be logged in
    await expect(page).toHaveURL(/\/(system-health|dashboard|projects|health)/, { timeout: 15000 });

    // Verify admin user is authenticated
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });

    // Verify system is now initialized
    const isInitialized = await setupState.checkStatus();
    expect(isInitialized).toBe(true);
  });

  test('should complete full setup wizard with all steps', async ({
    page,
    setupState,
    request,
  }) => {
    await setupState.ensureUninitialized();

    // Get setup mode
    const statusResponse = await request.get(`${E2E_API_URL}/api/v1/setup/status`);
    const status = await statusResponse.json();

    if (status.data?.setupMode !== 'full') {
      test.skip();
    }

    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Step 1: Admin credentials
    await page.getByLabel(/name/i).fill('Test Admin');
    await page.getByLabel(/email/i).fill('test-admin@example.com');
    await page.getByLabel(/password/i).fill('TestPassword123!');
    await page.getByRole('button', { name: /continue|next/i }).click();

    // Step 2: Instance configuration
    await page.getByLabel(/instance name/i).fill('Test Instance');
    await page.getByLabel(/instance url/i).fill(E2E_BASE_URL);
    await page.getByRole('button', { name: /continue|next/i }).click();

    // Step 3: Storage configuration (might be pre-filled from env)
    const storageTypeField = page.getByLabel(/storage type/i).first();
    const currentType = await storageTypeField.inputValue().catch(() => '');

    if (!currentType) {
      await page.getByLabel(/storage type/i).selectOption('minio');
      await page.getByLabel(/endpoint/i).fill('http://minio:9000');
      await page.getByLabel(/access key/i).fill('minioadmin123456');
      await page.getByLabel(/secret key/i).fill('minioadmin123456789012345678901234');
      await page.getByLabel(/bucket/i).fill('bugspotter-test');
    }

    // Submit setup
    await page.getByRole('button', { name: /complete|finish/i }).click();

    // Should redirect to dashboard and be logged in
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 15000 });

    // Verify admin user is authenticated
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });

    // Verify system is now initialized
    const isInitialized = await setupState.checkStatus();
    expect(isInitialized).toBe(true);
  });

  test('should prevent initialization when already initialized', async ({ page, setupState }) => {
    // Initialize first
    await setupState.ensureInitialized();

    // Try to access setup page
    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Should redirect away from setup
    await expect(page).not.toHaveURL(/\/setup/);
    await expect(page).toHaveURL(/\/(login|dashboard|projects)/);
  });
});

test.describe('Setup Flow - Initialized System', () => {
  test.beforeEach(async ({ setupState, page }) => {
    // Ensure system is initialized for these tests
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Admin User',
    });

    // Clear session state
    await page.context().clearCookies();
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch {
        // Storage APIs not available yet
      }
    });
  });

  test('should show login page when system is initialized', async ({ page, setupState }) => {
    const isInitialized = await setupState.checkStatus();
    expect(isInitialized).toBe(true);

    await page.goto('/', { waitUntil: 'networkidle' });

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });

    await page.getByLabel(/email/i).fill('admin@bugspotter.io');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });

    await page.getByLabel(/email/i).fill('admin@bugspotter.io');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Should show error
    await expect(page.getByText(/invalid|incorrect|failed|wrong/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to login when accessing /setup', async ({ page }) => {
    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should protect routes when not authenticated', async ({ page }) => {
    const protectedRoutes = ['/dashboard', '/projects', '/settings', '/users'];

    for (const route of protectedRoutes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });

  test('should persist authentication across reloads', async ({ page }) => {
    // Login
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill('admin@bugspotter.io');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Reload
    await page.reload({ waitUntil: 'networkidle' });

    // Should still be authenticated
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should logout and clear session', async ({ page }) => {
    // Login
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill('admin@bugspotter.io');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Logout
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });
    const userMenu = page.getByRole('button', { name: /profile|account|user menu/i });

    if (await userMenu.isVisible()) {
      await userMenu.click();
      // Wait for dropdown menu to open and logout button to be visible
      await logoutButton.waitFor({ state: 'visible', timeout: 2000 });
    }

    await logoutButton.click();

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });

    // Should not be able to access protected routes
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Setup Flow - State Transitions', () => {
  test('should transition from uninitialized to initialized', async ({ page, setupState }) => {
    // Start with uninitialized state
    await setupState.ensureUninitialized();

    // Verify uninitialized
    let status = await setupState.checkStatus();
    expect(status).toBe(false);

    // Initialize via API
    await setupState.ensureInitialized();

    // Verify initialized
    status = await setupState.checkStatus();
    expect(status).toBe(true);

    // UI should now show login instead of setup
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should return environment defaults only when uninitialized', async ({
    request,
    setupState,
  }) => {
    await setupState.ensureUninitialized();

    // Check status when uninitialized
    const uninitResponse = await request.get(`${E2E_API_URL}/api/v1/setup/status`);
    const uninitStatus = await uninitResponse.json();

    expect(uninitStatus.data.initialized).toBe(false);
    expect(uninitStatus.data.requiresSetup).toBe(true);
    // Defaults may or may not be present depending on env vars

    // Initialize
    await setupState.ensureInitialized();

    // Check status when initialized
    const initResponse = await request.get(`${E2E_API_URL}/api/v1/setup/status`);
    const initStatus = await initResponse.json();

    expect(initStatus.data.initialized).toBe(true);
    expect(initStatus.data.requiresSetup).toBe(false);
  });
});
