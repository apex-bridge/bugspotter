/**
 * Shared authentication helpers for E2E tests
 */

import type { Page } from '@playwright/test';
import { E2E_BASE_HOSTNAME } from '../config';

/**
 * Login as admin user for E2E tests
 * Skips login if already authenticated (for serial test execution)
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  // Check if already logged in (for serial test execution)
  const currentURL = page.url();
  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    // Already logged in, skip login process
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  // Wait for login button to be enabled and click it
  const loginButton = page.getByRole('button', { name: /sign in|login/i });
  await loginButton.waitFor({ state: 'visible', timeout: 10000 });

  // Use Promise.all to wait for navigation triggered by button click
  // This prevents race conditions where waitForURL starts before navigation begins
  await Promise.all([page.waitForURL('/dashboard', { timeout: 30000 }), loginButton.click()]);
}

/**
 * Login as any user for E2E tests.
 * Non-admin users redirect to /projects after login (via DefaultRedirect).
 * Admin users redirect to /dashboard.
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  expectedRedirect: string | RegExp = /\/(projects|dashboard)/
): Promise<void> {
  // Always go to login page fresh (different user than previous test)
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  const loginButton = page.getByRole('button', { name: /sign in|login/i });
  await loginButton.waitFor({ state: 'visible', timeout: 10000 });

  await Promise.all([page.waitForURL(expectedRedirect, { timeout: 30000 }), loginButton.click()]);
}
