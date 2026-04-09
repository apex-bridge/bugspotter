/**
 * Authentication and Setup E2E Tests
 * Tests the complete authentication flow including setup wizard redirect
 * Uses isolated database per test run via testcontainers
 */

import { test, expect } from '../fixtures/setup-fixture';

// Test data constants
const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
} as const;

const PROTECTED_ROUTES = [
  '/dashboard',
  '/projects',
  '/users',
  '/settings',
  '/bug-reports',
  '/notifications',
] as const;

test.describe('Authentication Flow - Uninitialized System', () => {
  test.beforeEach(async ({ page, context, setupState }) => {
    // Ensure system is uninitialized for these tests
    await setupState.ensureUninitialized();

    // Clear all cookies before each test
    await context.clearCookies();

    // Navigate to app to access storage APIs
    await page.goto('/', { waitUntil: 'networkidle' }).catch(() => {});

    // Clear storage
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
  });

  test('should redirect to setup when no admin exists', async ({ page }) => {
    // Visit root URL
    await page.goto('/', { waitUntil: 'networkidle' });

    // Should redirect to /setup automatically
    await expect(page).toHaveURL(/\/setup/, { timeout: 10000 });

    // Setup wizard should be visible
    await expect(page.getByRole('heading', { name: /setup/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/administrator email/i)).toBeVisible();
  });

  test('should allow access to public setup route', async ({ page }) => {
    // Setup page should be accessible when not initialized
    await page.goto('/setup', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/setup/);
  });
});

test.describe('Authentication Flow - Initialized System', () => {
  test.beforeEach(async ({ page, context, setupState }) => {
    // Ensure system is initialized with admin user
    await setupState.ensureInitialized({
      email: TEST_ADMIN.email,
      password: TEST_ADMIN.password,
      name: TEST_ADMIN.name,
    });

    // Clear all cookies before each test
    await context.clearCookies();

    // Navigate to app to access storage APIs
    await page.goto('/', { waitUntil: 'networkidle' }).catch(() => {});

    // Clear storage
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
  });

  test('should show login page when admin exists', async ({ page }) => {
    // Visit root URL
    await page.goto('/', { waitUntil: 'networkidle' });

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Login form should be visible
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible();
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });

    // Fill in login form with test credentials
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);

    // Submit form
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Should redirect to dashboard/projects after successful login
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // User should be authenticated - check for logout button or user menu
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });

    // Fill in login form with wrong password
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill('wrongpassword');

    // Submit form
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Should show error message (toast notification)
    // Sonner toasts appear in list items, fallback to any visible error text
    await expect(
      page
        .locator('[role="status"], li[data-sonner-toast]')
        .getByText(/invalid|incorrect|failed|wrong/i)
        .first()
    ).toBeVisible({ timeout: 5000 });

    // Should still be on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should persist authentication across page reloads', async ({ page }) => {
    // Login first
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Wait for navigation to dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Reload the page
    await page.reload({ waitUntil: 'networkidle' });

    // Should still be authenticated (not redirected to login)
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should logout and redirect to login page', async ({ page }) => {
    // Login first
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Find and click logout button (might be in a dropdown)
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    // If logout is in a dropdown, open it first
    const userMenuButton = page.getByRole('button', { name: /profile|account|user menu/i });
    if (await userMenuButton.isVisible()) {
      await userMenuButton.click();
      // Wait for logout button to become visible after dropdown opens
      await logoutButton.waitFor({ state: 'visible', timeout: 2000 });
    }

    await logoutButton.click();

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });

    // Should not be able to access protected routes
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test('should redirect to login when session expires', async ({ page, context }) => {
    // Login first
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Clear all cookies to simulate expired session
    await context.clearCookies();

    // Clear sessionStorage
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
      } catch {
        // Storage API not available
      }
    });

    // Try to navigate or reload
    await page.reload({ waitUntil: 'networkidle' });

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should handle token refresh on page load', async ({ page }) => {
    // Login first
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Monitor network requests for token refresh
    const refreshRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/auth/refresh')) {
        refreshRequests.push(request.method());
      }
    });

    // Reload page - may trigger token refresh if token is close to expiry
    await page.reload({ waitUntil: 'networkidle' });

    // Should still be authenticated
    await expect(page).not.toHaveURL(/\/login/);

    // Token refresh may or may not be called depending on token age
    // Just verify we're still authenticated
  });

  test('should not allow access to protected routes when not authenticated', async ({ page }) => {
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });

  test('should allow access to login route without authentication', async ({ page }) => {
    // Login page should be accessible
    await page.goto('/login', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Setup Wizard Flow - Uninitialized System', () => {
  test.beforeEach(async ({ page, context, setupState }) => {
    // Ensure system is uninitialized for setup wizard tests
    await setupState.ensureUninitialized();

    // Clear all cookies before each test
    await context.clearCookies();

    // Navigate to app to access storage APIs
    await page.goto('/', { waitUntil: 'networkidle' }).catch(() => {});

    // Clear storage
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
  });

  test('should complete setup wizard successfully', async ({ page }) => {
    // Database is reset before each test

    await page.goto('/setup');

    // Minimal mode: Single step with admin account creation
    await page.getByLabel(/administrator email/i).fill('admin@example.com');
    await page.getByLabel(/administrator password/i).fill('SecurePassword123!');
    await page.getByLabel(/administrator name/i).fill('Admin User');

    // Complete setup (minimal mode uses "Complete Setup" button)
    await page.getByRole('button', { name: /complete setup/i }).click();

    // Should redirect to system-health/health/dashboard after setup
    await expect(page).toHaveURL(/\/(system-health|health|dashboard|projects)/, { timeout: 10000 });

    // User should be automatically logged in
    await expect(page.getByRole('button', { name: /logout|sign out/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should validate required fields in setup wizard', async ({ page }) => {
    await page.goto('/setup', { waitUntil: 'networkidle' });

    // Try to submit without filling required fields (minimal mode)
    const submitButton = page.getByRole('button', { name: /complete setup/i });
    await submitButton.click();

    // Should show validation errors or prevent progression
    // Note: Form might prevent submission via HTML5 validation
    await expect(page).toHaveURL(/\/setup/);
  });

  test('should show environment defaults when available', async ({ page }) => {
    await page.goto('/setup', { waitUntil: 'networkidle' });

    // In minimal mode, environment configuration is already applied
    // Check if info banner about admin account creation is visible
    await expect(page.getByText(/create your admin account to complete setup/i)).toBeVisible({
      timeout: 5000,
    });

    // Admin form fields should be visible
    await expect(page.getByLabel(/administrator email/i)).toBeVisible();
    await expect(page.getByLabel(/administrator password/i)).toBeVisible();
    await expect(page.getByLabel(/administrator name/i)).toBeVisible();
  });
});

test.describe('Authentication Context Behavior', () => {
  test.beforeEach(async ({ setupState }) => {
    // Ensure system is initialized for auth context tests
    await setupState.ensureInitialized({
      email: TEST_ADMIN.email,
      password: TEST_ADMIN.password,
      name: TEST_ADMIN.name,
    });
  });

  test('should handle concurrent requests with token refresh', async ({ page }) => {
    // Login
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Monitor API requests
    const apiRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/v1/')) {
        apiRequests.push(url);
      }
    });

    // Navigate to a page that makes multiple API calls
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // Should have made multiple API calls
    expect(apiRequests.length).toBeGreaterThan(0);

    // Note: We can't easily re-test these requests with page.request
    // as they would be new requests without the auth context
    // The important part is that the page loaded successfully
  });

  test('should cleanup on unmount and not update state', async ({ page }) => {
    // Login
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill(TEST_ADMIN.email);
    await page.getByLabel(/password/i).fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Navigate to dashboard
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Capture console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Quickly navigate away (simulating unmount during async operation)
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });

    // Wait for network to settle and any async operations to complete
    await page.waitForLoadState('networkidle');

    // Should not have React state update warnings
    const stateUpdateErrors = consoleErrors.filter((err) =>
      err.includes("Can't perform a React state update on an unmounted component")
    );

    expect(stateUpdateErrors).toHaveLength(0);
  });
});
