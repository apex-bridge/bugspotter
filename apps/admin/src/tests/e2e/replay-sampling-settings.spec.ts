/**
 * E2E tests for mouse event sampling settings in admin panel
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';

test.describe('Replay Sampling Settings', () => {
  test.beforeEach(async ({ page, setupState }) => {
    // Ensure admin user exists
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Test Admin',
    });

    await loginAsAdmin(page);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  });

  test('should update mouse movement sampling rate', async ({ page }) => {
    // Find and adjust the mouse movement slider
    const mousemoveSlider = page.locator('#mousemove-sampling');
    await expect(mousemoveSlider).toBeVisible();

    // Change to 100ms
    await mousemoveSlider.fill('100');

    // Verify the displayed value updates
    await expect(page.getByText('100ms (10 FPS)', { exact: false }).first()).toBeVisible();

    // Save settings
    await page.getByRole('button', { name: /save changes/i }).click();

    // Wait for success toast (look for toast container or success indicator)
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /success|saved|updated/i })
    ).toBeVisible({ timeout: 15000 });

    // Reload page and verify persistence
    await page.reload();
    await expect(mousemoveSlider).toHaveValue('100');
  });

  test('should update scroll sampling rate', async ({ page }) => {
    // Find and adjust the scroll slider
    const scrollSlider = page.locator('#scroll-sampling');
    await expect(scrollSlider).toBeVisible();

    // Change to 200ms
    await scrollSlider.fill('200');

    // Verify the displayed value updates (200ms = 5 FPS)
    await expect(page.getByText('200ms (5 FPS)', { exact: false }).first()).toBeVisible();

    // Save settings
    await page.getByRole('button', { name: /save changes/i }).click();

    // Wait for success toast message
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /success|saved|updated/i })
    ).toBeVisible({ timeout: 15000 });

    // Reload page and verify persistence
    await page.reload();
    await expect(scrollSlider).toHaveValue('200');
  });

  test('should show FPS calculation correctly', async ({ page }) => {
    const mousemoveSlider = page.locator('#mousemove-sampling');

    // Test different values and their FPS calculations
    const testCases = [
      { value: '25', expectedFPS: '40' }, // 1000/25 = 40
      { value: '50', expectedFPS: '20' }, // 1000/50 = 20
      { value: '100', expectedFPS: '10' }, // 1000/100 = 10
      { value: '200', expectedFPS: '5' }, // 1000/200 = 5
    ];

    for (const testCase of testCases) {
      await mousemoveSlider.fill(testCase.value);
      await expect(
        page.getByText(new RegExp(`${testCase.value}ms \\(${testCase.expectedFPS} FPS\\)`)).first()
      ).toBeVisible();
    }
  });

  test('should respect slider constraints', async ({ page }) => {
    const mousemoveSlider = page.locator('#mousemove-sampling');
    const scrollSlider = page.locator('#scroll-sampling');

    // Check min/max/step attributes for mouse movement
    await expect(mousemoveSlider).toHaveAttribute('min', '25');
    await expect(mousemoveSlider).toHaveAttribute('max', '200');
    await expect(mousemoveSlider).toHaveAttribute('step', '25');

    // Check min/max/step attributes for scroll
    await expect(scrollSlider).toHaveAttribute('min', '50');
    await expect(scrollSlider).toHaveAttribute('max', '500');
    await expect(scrollSlider).toHaveAttribute('step', '50');
  });

  test('should show recommended values', async ({ page }) => {
    // Check that recommended values are highlighted
    await expect(page.getByText('50ms (20 FPS) - Recommended')).toBeVisible();
    await expect(page.getByText('100ms (10 FPS) - Recommended')).toBeVisible();
  });

  test('should update both sampling rates together', async ({ page }) => {
    // Change both sliders
    await page.locator('#mousemove-sampling').fill('75');
    await page.locator('#scroll-sampling').fill('150');

    // Save settings
    await page.getByRole('button', { name: /save changes/i }).click();

    // Wait for success toast (look for toast container or success indicator)
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /success|saved|updated/i })
    ).toBeVisible({ timeout: 15000 });

    // Reload and verify both persist
    await page.reload();
    await expect(page.locator('#mousemove-sampling')).toHaveValue('75');
    await expect(page.locator('#scroll-sampling')).toHaveValue('150');
  });

  test('should display helpful descriptions', async ({ page }) => {
    // Check for descriptive text
    await expect(
      page.getByText(/Control event sampling rates to balance replay smoothness with data size/i)
    ).toBeVisible();

    await expect(page.getByText(/Controls how often mouse movements are recorded/i)).toBeVisible();

    await expect(page.getByText(/Controls how often scroll events are recorded/i)).toBeVisible();
  });
});
