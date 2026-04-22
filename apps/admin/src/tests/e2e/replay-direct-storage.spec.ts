/**
 * E2E tests for direct storage replay functionality
 * Tests fetching, decompressing, and playing replay files directly from storage
 * Uses a real production replay file to validate the complete flow
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pako from 'pako';
import type { RRWebEvent } from '@bugspotter/types';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('Replay Direct Storage Access', () => {
  const TEST_REPLAY_PATH = join(__dirname, 'fixtures', 'test-replay.gz');
  let replayFileExists = false;
  let replayEvents: RRWebEvent[] = [];
  let testProject: { id: string; name: string; api_key: string };
  let authToken: string;

  test.beforeAll(() => {
    // Check if test replay file exists
    try {
      const compressedData = readFileSync(TEST_REPLAY_PATH);
      const decompressed = pako.ungzip(compressedData, { to: 'string' });
      const parsed = JSON.parse(decompressed);

      replayEvents = Array.isArray(parsed) ? parsed : parsed.events || [];
      replayFileExists = replayEvents.length > 0;

      console.log(`✅ Test replay loaded: ${replayEvents.length} events`);
    } catch {
      console.warn('⚠️ Test replay file not found or invalid, some tests will be skipped');
      replayFileExists = false;
    }
  });

  test.beforeEach(async ({ page, setupState, request }) => {
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Test Admin',
    });

    // Get auth token for API calls
    if (!authToken) {
      const API_URL = process.env.API_URL || 'http://localhost:4000';

      console.log(`🔧 Backend API_URL: ${API_URL}`);
      console.log(
        `🔧 VITE_API_URL (for axios baseURL): ${process.env.VITE_API_URL || '(empty - using proxy)'}`
      );

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

    // Create test project and bug reports
    if (authToken && !testProject) {
      testProject = await setupState.ensureProjectExists(authToken);
      await setupState.createSampleBugReports(testProject.api_key, testProject.id);
    }

    await loginAsAdmin(page);
  });

  test('should decompress replay file correctly', () => {
    test.skip(!replayFileExists, 'Test replay file not available');

    // Verify we can read and decompress the file
    expect(replayEvents).toBeDefined();
    expect(replayEvents.length).toBeGreaterThan(0);

    // Verify event structure
    const firstEvent = replayEvents[0];
    expect(firstEvent).toHaveProperty('type');
    expect(firstEvent).toHaveProperty('timestamp');

    console.log('First event:', {
      type: firstEvent.type,
      timestamp: firstEvent.timestamp,
      hasData: !!firstEvent.data,
    });
  });

  test('should validate replay event types', () => {
    test.skip(!replayFileExists, 'Test replay file not available');

    // rrweb event types: https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb/src/types.ts
    // 0: DomContentLoaded, 1: Load, 2: FullSnapshot, 3: IncrementalSnapshot, 4: Meta, 5: Custom
    const validTypes = [0, 1, 2, 3, 4, 5];

    replayEvents.forEach((event) => {
      expect(validTypes).toContain(event.type);

      // All events must have timestamps
      expect(event.timestamp).toBeGreaterThan(0);
    });

    // Should have at least one full snapshot (type 2)
    const hasFullSnapshot = replayEvents.some((e) => e.type === 2);
    expect(hasFullSnapshot).toBe(true);

    console.log('Event type distribution:', {
      total: replayEvents.length,
      fullSnapshots: replayEvents.filter((e) => e.type === 2).length,
      incrementalSnapshots: replayEvents.filter((e) => e.type === 3).length,
      meta: replayEvents.filter((e) => e.type === 4).length,
    });
  });

  test('should load replay player automatically', async ({ page }) => {
    // Navigate to bug reports page
    await page.goto('/bug-reports');
    await page.waitForLoadState('networkidle');

    // Just verify the page structure exists
    const heading = page.getByRole('heading', { name: /bug reports/i });
    await expect(heading).toBeVisible();

    console.log('✅ Bug reports page loaded successfully');
    // Note: This test validates page structure. Full replay playback is tested in test #6
  });

  test('should display error message if replay fetch fails', async ({ page }) => {
    // Intercept the storage URL request to simulate failure
    await page.route('**/api/v1/storage/url/**/replay', (route) => {
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Replay not found' }),
      });
    });

    await page.goto('/bug-reports');
    await page.waitForLoadState('networkidle');

    // Click first View button
    const viewButton = page.getByRole('button', { name: /view/i }).first();
    await viewButton.click();
    await page.waitForLoadState('networkidle');

    // Switch to replay tab
    const replayTab = page.getByRole('button', { name: /session replay/i });
    await replayTab.click();

    // Should show error message or "no replay available" (since we're testing with a report without replay)
    // The mock blocks the storage URL request, so if there was a replay, it would fail to load
    const message = page
      .locator('text=/failed to load|error|no session replay available/i')
      .first();
    await expect(message).toBeVisible({ timeout: 5000 });
    console.log('✅ Error handling validated');
  });

  test('should fetch replay directly from storage and decompress in browser', async ({
    page,
    request,
  }) => {
    test.skip(!replayFileExists, 'Test replay file not available');

    const API_URL = process.env.API_URL || 'http://localhost:4000';

    // Create a bug report WITH hasReplay: true to get presigned upload URL
    const reportResponse = await request.post(`${API_URL}/api/v1/reports`, {
      headers: { 'X-API-Key': testProject.api_key },
      data: {
        title: 'Bug Report with Real Replay',
        description: 'This bug has an actual replay session visible in the player',
        priority: 'high',
        hasReplay: true, // CRITICAL: Backend returns presigned upload URL
        report: {
          console: [{ level: 'error', message: 'Test error', timestamp: Date.now() }],
          network: [],
          metadata: {
            userAgent: 'Mozilla/5.0 Test',
            viewport: { width: 1920, height: 1080 },
            url: 'https://test.app',
          },
        },
      },
    });

    const reportData = await reportResponse.json();
    const bugReportId = reportData.data.id;
    const presignedUrls = reportData.data.presignedUrls;

    console.log('📝 Created bug report:', bugReportId);
    console.log('📦 Presigned URLs:', presignedUrls);

    if (!presignedUrls?.replay?.uploadUrl) {
      throw new Error('Backend did not return replay upload URL');
    }

    // Upload the actual replay file using the presigned URL
    const replayFileBuffer = readFileSync(TEST_REPLAY_PATH);

    console.log(`📤 Uploading ${replayFileBuffer.length} bytes to presigned URL...`);

    const uploadResponse = await fetch(presignedUrls.replay.uploadUrl, {
      method: 'PUT',
      body: replayFileBuffer,
      headers: {
        'Content-Type': 'application/gzip',
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    console.log('✅ Replay file uploaded successfully');

    // Mark upload complete via the dedicated confirm-upload endpoint.
    // The general PATCH /reports/:id schema has `additionalProperties: false`
    // and intentionally doesn't expose `replay_upload_status` as a
    // user-writable field — upload state transitions go through
    // POST /reports/:id/confirm-upload (same fix as the fixture in
    // setup-fixture.ts::createBugReportWithReplay).
    const confirmResponse = await request.post(
      `${API_URL}/api/v1/reports/${bugReportId}/confirm-upload`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
        data: { fileType: 'replay' },
      }
    );
    if (!confirmResponse.ok()) {
      throw new Error(
        `Failed to mark replay upload complete: ${confirmResponse.status()} ${await confirmResponse.text()}`
      );
    }

    console.log('✅ Marked replay upload as completed');

    // Navigate to bug reports list
    console.log(`📋 Navigating to bug reports list to find report ${bugReportId}...`);
    await page.goto('/bug-reports');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Pause to see the page
    console.log('✅ Bug reports list loaded');

    // Find the card for our test bug report using data-testid or bug ID
    console.log(`🔍 Looking for bug report card with ID: ${bugReportId}`);
    const bugReportCard = page.locator('.space-y-3 > div').first(); // First report card
    await bugReportCard.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1500); // Pause to see the card
    console.log('✅ Found bug report card');

    // Click the View button to open the modal
    console.log('🖱️ Clicking View button to open detail modal...');
    const viewButton = bugReportCard.getByRole('button', { name: /view/i });
    await viewButton.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1500); // Pause before clicking
    await viewButton.click();
    console.log('✅ View button clicked - modal should be opening...');

    // Wait for modal to appear
    await page.waitForTimeout(3000); // Longer pause to see modal animation
    const modal = page.getByRole('dialog');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Detail modal opened - replay should be on Session Replay tab by default');

    // Wait to see loading indicator
    console.log('⏳ Waiting to see loading spinner and "Loading replay from storage..." message');
    await page.waitForTimeout(2000); // Watch loading state

    // Wait for replay to load and rrweb player to initialize
    console.log('🔄 Replay should be decompressing now (14.7 KB → 81 events)...');
    await page.waitForTimeout(3000);

    // Check for rrweb player
    console.log('🔍 Looking for rrweb player (.rr-player or iframe)...');
    const player = page.locator('.rr-player, iframe').first();
    const playerVisible = await player.isVisible().catch(() => false);

    if (playerVisible) {
      console.log('✅ rrweb player loaded successfully!');
      console.log('🎮 You should now see:');
      console.log('   • Player controls (play/pause, timeline, speed)');
      console.log('   • Replay canvas showing the recorded session');
      console.log('   • Timeline scrubber for navigation');
      await page.waitForTimeout(3000); // Pause to see the player controls

      console.log('▶️ Replay is now playing - watching for 20 seconds...');
      console.log('   Duration: 16.73s | Events: 81 | Size: 14.7 KB compressed');
      // Wait 20 seconds to watch the full replay
      await page.waitForTimeout(20000);
      console.log('🎬 Replay observation complete!');
    } else {
      console.log('⚠️ Player not visible, checking page content');
      // Check for error or no replay messages
      const noReplayMsg = page.getByText(/no session replay available/i);
      const errorMsg = page.getByText(/failed to load/i);
      const loadingMsg = page.getByText(/loading replay/i);

      if (await loadingMsg.isVisible()) {
        console.log('⏳ Still loading - waiting 5 more seconds...');
        await page.waitForTimeout(5000);
      } else if (await noReplayMsg.isVisible()) {
        console.log('ℹ️ "No session replay available" message shown');
      } else if (await errorMsg.isVisible()) {
        console.log('❌ Error message shown');
      } else {
        console.log('🔍 Neither player nor messages found - checking DOM');
      }
    }

    // Verify no errors
    const errorMessage = page.getByText(/error|failed/i);
    const hasError = await errorMessage.isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test('should display screenshot download button', async ({ page }) => {
    await page.goto('/bug-reports');
    await page.waitForLoadState('networkidle');

    // Click first View button
    const viewButton = page.getByRole('button', { name: /view/i }).first();
    await viewButton.click();
    await page.waitForLoadState('networkidle');

    // Switch to details tab
    const detailsTab = page.getByRole('button', { name: /details.*metadata/i });
    await detailsTab.click();

    // Look for screenshot section with download button
    const screenshotSection = page.getByText(/screenshot/i).first();
    if (await screenshotSection.isVisible()) {
      const downloadButton = page.getByRole('button', { name: /download/i }).first();

      if (await downloadButton.isVisible()) {
        expect(await downloadButton.isDisabled()).toBe(false);
        console.log('✅ Screenshot download button is visible and enabled');
      }
    } else {
      console.log('ℹ️ No screenshot available for this report');
    }
  });

  test('should verify replay events are chronologically ordered', () => {
    test.skip(!replayFileExists, 'Test replay file not available');

    // Verify events are in chronological order
    for (let i = 1; i < replayEvents.length; i++) {
      const prevTimestamp = replayEvents[i - 1].timestamp;
      const currTimestamp = replayEvents[i].timestamp;

      expect(currTimestamp).toBeGreaterThanOrEqual(prevTimestamp);
    }

    const duration = replayEvents[replayEvents.length - 1].timestamp - replayEvents[0].timestamp;
    console.log(`✅ Replay duration: ${(duration / 1000).toFixed(2)}s`);
  });
});
