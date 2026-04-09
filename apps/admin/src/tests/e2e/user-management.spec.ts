/**
 * User Management E2E Tests
 * Tests user creation, editing, deletion, and password validation
 */

import { test, expect } from '../fixtures/setup-fixture';

test.describe('User Management', () => {
  test.beforeEach(async ({ page, setupState }) => {
    // Ensure system is initialized with admin user
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Admin User',
    });

    // Login as admin
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(/email/i).fill('admin@bugspotter.io');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|projects|health)/, { timeout: 10000 });

    // Navigate to users page
    await page.goto('/users', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /user management/i })).toBeVisible();
  });

  test.describe('Password Validation', () => {
    test('should show helper text for password requirements', async ({ page }) => {
      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Modal should open
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('heading', { name: /create user/i })).toBeVisible();

      // Password field should have helper text
      const passwordInput = page.locator('input[type="password"]');
      await expect(passwordInput).toBeVisible();

      // Helper text should be visible
      await expect(page.getByText(/minimum 8 characters/i)).toBeVisible();
    });

    test('should enforce minimum password length (8 characters)', async ({ page }) => {
      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in form with too short password
      await page.locator('input[type="email"]').fill('testuser@example.com');
      await page.locator('input[type="text"]').fill('Test User');
      await page.locator('input[type="password"]').fill('short'); // Only 5 characters
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Try to submit
      await page.getByRole('button', { name: /^create$/i }).click();

      // HTML5 validation should prevent submission
      const passwordInput = page.locator('input[type="password"]');
      const validationMessage = await passwordInput.evaluate(
        (el: HTMLInputElement) => el.validationMessage
      );

      expect(validationMessage).toBeTruthy();
    });

    test('should enforce maximum password length (128 characters)', async ({ page }) => {
      const longPassword = 'a'.repeat(129); // 129 characters

      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in form with too long password
      await page.locator('input[type="email"]').fill('toolong@example.com');
      await page.locator('input[type="text"]').fill('Too Long User');
      await page.locator('input[type="password"]').fill(longPassword);
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Submit form
      await page.getByRole('button', { name: /^create$/i }).click();

      // Backend should reject with 400 error
      // Note: HTML5 maxLength can be bypassed programmatically (.fill()),
      // so we verify backend validation by checking modal stays open
      await expect(page.getByRole('dialog')).toBeVisible();
      // Toast or error message would appear here in real implementation
    });

    test('should accept valid password (8-128 characters)', async ({ page }) => {
      const validPassword = 'ValidPass123';

      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in form with valid password
      await page.locator('input[type="email"]').fill('validuser@example.com');
      await page.locator('input[type="text"]').fill('Valid User');
      await page.locator('input[type="password"]').fill(validPassword);
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Submit form
      await page.getByRole('button', { name: /^create$/i }).click();

      // Should succeed - modal should close and user should appear in table
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
      await expect(page.getByText('validuser@example.com')).toBeVisible({ timeout: 5000 });
    });

    test('should accept minimum valid password (exactly 8 characters)', async ({ page }) => {
      const minPassword = 'Pass1234'; // Exactly 8 characters

      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in form with minimum valid password
      await page.locator('input[type="email"]').fill('minpass@example.com');
      await page.locator('input[type="text"]').fill('Min Pass User');
      await page.locator('input[type="password"]').fill(minPassword);
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Submit form
      await page.getByRole('button', { name: /^create$/i }).click();

      // Should succeed
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
      await expect(page.getByText('minpass@example.com')).toBeVisible({ timeout: 5000 });
    });

    test('should accept maximum valid password (exactly 128 characters)', async ({ page }) => {
      const maxPassword = 'a'.repeat(128); // Exactly 128 characters

      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in form with maximum valid password
      await page.locator('input[type="email"]').fill('maxpass@example.com');
      await page.locator('input[type="text"]').fill('Max Pass User');
      await page.locator('input[type="password"]').fill(maxPassword);
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Submit form
      await page.getByRole('button', { name: /^create$/i }).click();

      // Should succeed
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
      await expect(page.getByText('maxpass@example.com')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('User Creation', () => {
    test('should create user with all required fields', async ({ page }) => {
      // Click Add User button
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in form
      await page.locator('input[type="email"]').fill('newuser@example.com');
      await page.locator('input[type="text"]').fill('New User');
      await page.locator('input[type="password"]').fill('SecurePass123');
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Submit form
      await page.getByRole('button', { name: /^create$/i }).click();

      // Verify success
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
      await expect(page.getByText('newuser@example.com')).toBeVisible({ timeout: 5000 });
    });

    test('should require email field', async ({ page }) => {
      await page.getByRole('button', { name: /add user/i }).click();

      // Leave email empty
      await page.locator('input[type="text"]').fill('No Email User');
      await page.locator('input[type="password"]').fill('SecurePass123');
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');

      // Try to submit
      await page.getByRole('button', { name: /^create$/i }).click();

      // Should show validation error (HTML5 required)
      const emailInput = page.locator('input[type="email"]');
      const validationMessage = await emailInput.evaluate(
        (el: HTMLInputElement) => el.validationMessage
      );
      expect(validationMessage).toBeTruthy();
    });

    test('should cancel user creation', async ({ page }) => {
      await page.getByRole('button', { name: /add user/i }).click();

      // Fill in some data
      await page.locator('input[type="email"]').fill('cancelled@example.com');

      // Click cancel
      await page.getByRole('button', { name: /cancel/i }).click();

      // Modal should close without creating user
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page.getByText('cancelled@example.com')).not.toBeVisible();
    });
  });

  test.describe('User Editing', () => {
    test('should not show password field when editing user', async ({ page }) => {
      // Wait for users table to load
      await expect(page.getByRole('table')).toBeVisible({ timeout: 5000 });

      // Click edit button for admin user (second button in Actions column)
      await page
        .getByRole('row')
        .filter({ hasText: 'admin@bugspotter.io' })
        .getByRole('button')
        .nth(1) // Edit button is second (after Projects button)
        .click();

      // Modal should open
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('heading', { name: /edit user/i })).toBeVisible();

      // Password field should NOT be visible when editing
      await expect(page.locator('input[type="password"]')).not.toBeVisible();

      // But email, name, and role should be visible
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="text"]')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();
    });

    test('should update user information', async ({ page }) => {
      // First create a user to edit
      await page.getByRole('button', { name: /add user/i }).click();
      await page.locator('input[type="email"]').fill('editable@example.com');
      await page.locator('input[type="text"]').fill('Editable User');
      await page.locator('input[type="password"]').fill('SecurePass123');
      await page.getByRole('dialog').getByRole('combobox').selectOption('user');
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

      // Now edit the user
      await page
        .getByRole('row')
        .filter({ hasText: 'editable@example.com' })
        .getByRole('button')
        .nth(1) // Edit button is second (after Projects button)
        .click();

      // Update name and role
      await page.locator('input[type="text"]').clear();
      await page.locator('input[type="text"]').fill('Updated User Name');
      await page.getByRole('dialog').getByRole('combobox').selectOption('admin');

      // Submit
      await page.getByRole('button', { name: /update/i }).click();

      // Verify changes
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
      const userRow = page.getByRole('row').filter({ hasText: 'editable@example.com' });
      await expect(userRow.getByText('Updated User Name')).toBeVisible();
      await expect(userRow.getByText('admin')).toBeVisible();
    });
  });
});
