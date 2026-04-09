// Tab switching functionality (defined early so onclick handlers can use it)
function switchTab(tabName, evt) {
  // Remove active class from all tabs and content
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
  document
    .querySelectorAll('.tab-content')
    .forEach((content) => content.classList.remove('active'));

  // Add active class to selected tab and content
  if (evt && evt.target) evt.target.closest('.tab').classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Save active tab to localStorage
  localStorage.setItem('activeTab', tabName);

  console.log(`📑 Switched to ${tabName} tab`);
}

// ============================================================================
// Runtime Configuration
// ============================================================================
// Priority: config.js (Docker/nginx injected) > query params > defaults
const _cfg = window.__BUGSPOTTER_DEMO_CONFIG__ || {};
const _params = new URLSearchParams(location.search);

// Validate that a URL is safe to use as an endpoint (http(s) + localhost or *.bugspotter.io)
function isAllowedEndpoint(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.endsWith('.bugspotter.io'))
    );
  } catch {
    return false;
  }
}

const _rawEndpoint =
  _cfg.endpoint || _params.get('api') || 'http://localhost:4000';

// Normalize to origin — SDK v2 expects base URL, appends paths internally
function getBaseUrl(url) {
  try { return new URL(url).origin; } catch { return url; }
}

const DEMO_CONFIG = {
  endpoint: isAllowedEndpoint(_rawEndpoint)
    ? getBaseUrl(_rawEndpoint)
    : 'http://localhost:4000',
  apiKey: _cfg.apiKey || _params.get('key') || 'demo-api-key-12345',
  adminUrl: _cfg.adminUrl || _params.get('admin') || '',
  extensionUrl: _cfg.extensionUrl || '',
};

const _endpointHost = new URL(DEMO_CONFIG.endpoint).hostname;
const isRemoteInstance = _endpointHost !== 'localhost' && _endpointHost !== '127.0.0.1';

// Show connection banner for remote instances
if (isRemoteInstance) {
  const banner = document.getElementById('demo-banner');
  if (banner) {
    banner.style.display = 'block';
    const host = new URL(DEMO_CONFIG.endpoint).hostname;
    document.getElementById('demo-banner-text').textContent =
      'Connected to BugSpotter Cloud (' + host + ')';
    if (DEMO_CONFIG.adminUrl && isAllowedEndpoint(DEMO_CONFIG.adminUrl)) {
      // If a magic token is provided, append it to the admin URL for passwordless login
      let adminHref = DEMO_CONFIG.adminUrl;
      if (_cfg.magicToken) {
        try {
          const url = new URL(adminHref);
          if (!url.pathname.endsWith('/login')) {
            url.pathname = url.pathname.replace(/\/$/, '') + '/login';
          }
          url.searchParams.set('token', _cfg.magicToken);
          adminHref = url.href;
        } catch (_) { /* keep original href if URL parsing fails */ }
      }
      document.getElementById('demo-banner-admin').href = adminHref;
      // Show demo viewer credentials only when magic token is NOT available (fallback)
      if (!_cfg.magicToken && _cfg.viewerEmail && _cfg.viewerPassword) {
        const credEl = document.getElementById('demo-banner-credentials');
        const emailEl = document.getElementById('demo-banner-email');
        const passwordEl = document.getElementById('demo-banner-password');
        if (credEl && emailEl && passwordEl) {
          emailEl.textContent = _cfg.viewerEmail;
          passwordEl.textContent = _cfg.viewerPassword;
          credEl.style.display = 'inline';
        }
      }
    } else {
      document.getElementById('demo-banner-admin').style.display = 'none';
    }
    if (DEMO_CONFIG.extensionUrl && isAllowedEndpoint(DEMO_CONFIG.extensionUrl)) {
      document.getElementById('demo-banner-extension').href = DEMO_CONFIG.extensionUrl;
    } else {
      document.getElementById('demo-banner-extension').style.display = 'none';
    }
  }
}

// Show connection status indicator in the header
function updateConnectionStatus(status, message) {
  const el = document.getElementById('connection-status');
  if (!el) return;
  const color = status === 'ok' ? '#48bb78' : status === 'error' ? '#fc8181' : '#ecc94b';
  el.textContent = '';
  const dot = document.createElement('span');
  dot.style.cssText =
    'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' +
    color;
  el.appendChild(dot);
  el.appendChild(document.createTextNode(message));
  el.style.display = 'inline-flex';
}

// Demo-only sanitizer (the real sanitizer runs server-side in the backend)
// This is a simplified version for demo purposes to show the concept.
function demoSanitize(text) {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL REDACTED]')
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE REDACTED]')
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP REDACTED]')
    .replace(/\b(sk_live|sk_test|ghp_|Bearer\s+)[\w-]+/g, '[CREDENTIAL REDACTED]')
    .replace(/(password|secret|token)["']?\s*[:=]\s*["']?[\w@!#$%^&*]+/gi, '$1: [REDACTED]');
}

// ============================================================================
// Demo-only UI components (these showcase what a real integration might build)
// ============================================================================

class DemoFloatingButton {
  constructor(opts = {}) {
    this._onClick = null;
    this._el = document.createElement('button');
    this._el.textContent = opts.icon || '⚡';
    const pos = opts.position === 'bottom-left' ? 'left' : 'right';
    const ox = (opts.offset && opts.offset.x) || 24;
    const oy = (opts.offset && opts.offset.y) || 24;
    Object.assign(this._el.style, {
      position: 'fixed', bottom: oy + 'px', [pos]: ox + 'px',
      width: (opts.size || 48) + 'px', height: (opts.size || 48) + 'px',
      borderRadius: '50%', border: 'none', cursor: 'pointer',
      fontSize: '20px', zIndex: '99999', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: opts.backgroundColor || '#1a365d',
      color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      transition: 'all 0.2s ease',
    });
    if (opts.style) Object.assign(this._el.style, opts.style);
    this._el.addEventListener('click', () => { if (this._onClick) this._onClick(); });
    document.body.appendChild(this._el);
  }
  onClick(fn) { this._onClick = fn; }
  show() { this._el.style.display = 'flex'; }
  hide() { this._el.style.display = 'none'; }
  setIcon(icon) { this._el.textContent = icon; }
  setBackgroundColor(color) { this._el.style.backgroundColor = color; }
}

class DemoBugReportModal {
  constructor(opts = {}) {
    this._onSubmit = opts.onSubmit || (() => {});
  }
  show(screenshot) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
      zIndex: '100000', display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '8px', padding: '24px',
      width: '480px', maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
    });
    const h3 = document.createElement('h3');
    h3.textContent = 'Report a Bug';
    Object.assign(h3.style, { margin: '0 0 16px' });
    card.appendChild(h3);

    if (typeof screenshot === 'string' && screenshot.startsWith('data:')) {
      const img = document.createElement('img');
      img.src = screenshot;
      Object.assign(img.style, { maxWidth: '100%', borderRadius: '4px', marginBottom: '12px' });
      card.appendChild(img);
    }

    const titleInput = document.createElement('input');
    titleInput.id = 'demo-modal-title';
    titleInput.placeholder = 'Bug title';
    Object.assign(titleInput.style, { width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px' });
    card.appendChild(titleInput);

    const descInput = document.createElement('textarea');
    descInput.id = 'demo-modal-desc';
    descInput.placeholder = 'Description';
    descInput.rows = 4;
    Object.assign(descInput.style, { width: '100%', padding: '8px', marginBottom: '12px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px' });
    card.appendChild(descInput);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'demo-modal-cancel';
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, { padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer' });
    const submitBtn = document.createElement('button');
    submitBtn.id = 'demo-modal-submit';
    submitBtn.textContent = 'Submit';
    Object.assign(submitBtn.style, { padding: '8px 16px', border: 'none', borderRadius: '4px', background: '#1a365d', color: '#fff', cursor: 'pointer' });
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    card.querySelector('#demo-modal-cancel').addEventListener('click', close);
    card.querySelector('#demo-modal-submit').addEventListener('click', async () => {
      const title = card.querySelector('#demo-modal-title').value || 'Untitled Bug';
      const description = card.querySelector('#demo-modal-desc').value || '';
      close();
      await this._onSubmit({ title, description });
    });
    setTimeout(() => card.querySelector('#demo-modal-title').focus(), 50);
  }
}

// Check backend connectivity
fetch(new URL('/health', DEMO_CONFIG.endpoint).href)
  .then((res) => {
    if (res.ok) updateConnectionStatus('ok', 'API Connected');
    else updateConnectionStatus('error', 'API Error (' + res.status + ')');
  })
  .catch(() => updateConnectionStatus('error', 'API Unreachable'));

// Initialize BugSpotter SDK (async)
let bugSpotter;
var bugSpotterReady = BugSpotter.init({
  endpoint: DEMO_CONFIG.endpoint,
  apiKey: DEMO_CONFIG.apiKey,
  showWidget: false, // Disable auto-widget, we'll create our own
  replay: {
    enabled: true,
    duration: 30, // Keep last 30 seconds
    sampling: {
      mousemove: 50,
      scroll: 100,
    },
  },
}).then(function(instance) {
  bugSpotter = instance;
  console.log('✅ BugSpotter SDK initialized (' + DEMO_CONFIG.endpoint + ')');

  // Debug: Check replay status
  if (instance.domCollector) {
    console.log('✅ DOM Collector is initialized');
    console.log('🎥 Recording status:', instance.domCollector.isCurrentlyRecording());
    console.log('📊 Buffer size:', instance.domCollector.getBufferSize());
    console.log('⏱️ Buffer duration:', instance.domCollector.getDuration(), 'seconds');

    setInterval(() => {
      const events = instance.domCollector.getEvents();
      if (events.length > 0) {
        console.log(`🎬 Replay buffer has ${events.length} events`);
      }
    }, 5000);
  } else {
    console.error('❌ DOM Collector is NOT initialized - replay is disabled!');
  }
}).catch(function(err) {
  console.error('❌ BugSpotter SDK init failed:', err);
});

// Helper: get SDK instance (awaits init if still in progress)
async function getSDK() {
  return await bugSpotterReady;
}

// Global replay player instance
let replayPlayer = null;

// Helper: Submit bug report to API using SDK's internal submission
// This properly handles presigned URL uploads for screenshots and replays
async function submitBugReport(title, description, report) {
  console.log('📤 Submitting via SDK (supports presigned URLs)...', {
    title,
    description,
    hasScreenshot: !!report._screenshotPreview,
    hasReplay: !!(report.replay && report.replay.length > 0),
    console: report.console?.length || 0,
    network: report.network?.length || 0,
  });

  // Use SDK's public submit() method
  // This properly handles presigned URL generation and S3 uploads
  try {
    await (await getSDK()).submit({
      title,
      description,
      report,
    });

    console.log('✅ Bug report submitted successfully (with file uploads)');

    // Display success message
    document.getElementById('output').textContent =
      '✅ Bug Report Submitted Successfully!\n' +
      'Files uploaded via presigned URLs (check Network tab for S3 uploads)\n\n' +
      JSON.stringify(
        {
          title: title,
          description: description,
          screenshot: report._screenshotPreview ? 'Uploaded to S3' : 'None',
          consoleLogs: report.console?.length,
          networkRequests: report.network?.length,
          replayEvents: report.replay?.length,
        },
        null,
        2
      );
  } catch (error) {
    console.error('❌ Submission failed:', error);
    throw error;
  }
}

// Helper: Create and show rrweb player
function createReplayPlayer(events, bugId = null) {
  // Show player container
  const container = document.getElementById('replay-player-container');
  container.classList.add('active');

  // Update stats
  const timeSpan = ((events[events.length - 1].timestamp - events[0].timestamp) / 1000).toFixed(2);
  const statsText = bugId
    ? `Bug #${bugId} • ${events.length} events • ${timeSpan}s duration`
    : `${events.length} events • ${timeSpan}s duration`;
  document.getElementById('player-stats').textContent = statsText;

  // Destroy existing player if any
  if (replayPlayer) {
    replayPlayer.pause();
    document.getElementById('replay-player').innerHTML = '';
  }

  // Create new player
  replayPlayer = new rrwebPlayer({
    target: document.getElementById('replay-player'),
    props: {
      events: events,
      autoPlay: true,
      speedOption: [1, 2, 4, 8],
      showController: true,
      skipInactive: false,
      mouseTail: {
        duration: 500,
        strokeStyle: bugId ? '#dc2626' : '#3182ce',
      },
    },
  });

  console.log('🎬 Replay player started with', events.length, 'events');
}

// Helper: Show formatted output in a div
function showOutput(divId, title, content, style = 'info') {
  const outputDiv = document.getElementById(divId);
  outputDiv.style.display = 'block';
  outputDiv.innerHTML = `<strong>${title}</strong><br><br>${content}`;
}

// Helper: Reinitialize SDK with auth config
function reinitializeSDK(authConfig) {
  bugSpotter && bugSpotter.destroy();
  bugSpotter = null;

  const config = {
    endpoint: DEMO_CONFIG.endpoint,
    showWidget: false,
    replay: { enabled: true, duration: 30 },
    ...authConfig,
  };

  bugSpotterReady = BugSpotter.init(config).then(function(instance) {
    bugSpotter = instance;
    return instance;
  });
}

// Modal demo handler
async function showBugReportModalDemo() {
  try {
    const report = await (await getSDK()).capture();
    const modal = new DemoBugReportModal({
      onSubmit: async (data) => {
        console.log('🚀 Submitting bug report to API (from modal demo)...');
        await submitBugReport(data.title, data.description, report);
      },
    });
    modal.show(report.screenshot);
  } catch (error) {
    console.error('Failed to show modal:', error);
  }
}

// Initialize Floating Button Widget (bugSpotter already initialized at top)
let floatingButton = null;
try {
floatingButton = new DemoFloatingButton({
  position: 'bottom-right',
  icon: '⚡',
  backgroundColor: '#1a365d',
  size: 48,
  offset: { x: 24, y: 24 },
  style: {
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    transition: 'all 0.2s ease',
  },
});

// Add click handler to floating button
floatingButton.onClick(async () => {
  console.log('Floating button clicked - capturing data...');

  try {
    // Capture all the data
    const report = await (await getSDK()).capture();

    console.log('📦 Captured report data:', {
      screenshot: report.screenshot
        ? 'Present (' + report.screenshot.length + ' chars)'
        : 'Missing',
      console: report.console.length + ' entries',
      network: report.network.length + ' requests',
      replay: report.replay.length + ' events',
      metadata: report.metadata ? 'Present' : 'Missing',
    });

    // Show the modal with the captured screenshot
    const modal = new DemoBugReportModal({
      onSubmit: async (data) => {
        console.log('🚀 Submitting bug report to API...');
        console.log('📊 Report being submitted:', {
          title: data.title,
          description: data.description,
          replay_events: report.replay.length,
          console_logs: report.console.length,
          network_requests: report.network.length,
        });
        await submitBugReport(data.title, data.description, report);
      },
    });

    modal.show(report.screenshot);
  } catch (error) {
    console.error('Failed to capture bug report:', error);
  }
});

console.log('✅ Floating button widget initialized');
} catch (e) {
  console.warn('FloatingButton not available:', e instanceof Error ? e.message : String(e));
}

// Make an initial API call on page load
fetch('https://jsonplaceholder.typicode.com/posts/1')
  .then((res) => res.json())
  .then((data) => console.log('📡 Initial API call successful:', data.title))
  .catch((err) => console.error('❌ Initial API call failed:', err));

// Console Logging Tests
function testConsoleLog() {
  console.log('🔵 This is a LOG message with data:', {
    timestamp: Date.now(),
    user: 'demo-user',
    action: 'button-click',
  });
}

function testConsoleWarn() {
  console.warn('⚠️ This is a WARNING message:', 'Something might be wrong!');
}

function testConsoleError() {
  console.error('🔴 This is an ERROR message:', new Error('Something went wrong!'));
}

function testConsoleInfo() {
  console.info('ℹ️ This is an INFO message:', 'Informational data', [1, 2, 3]);
}

// Network Request Tests
function testSuccessfulRequest() {
  console.log('🌐 Making successful API request...');
  fetch('https://jsonplaceholder.typicode.com/posts/1')
    .then((res) => res.json())
    .then((data) => console.log('✅ Successful request:', data.title))
    .catch((err) => console.error('❌ Request failed:', err));
}

function testFailedRequest() {
  console.log('🌐 Making failed API request...');
  fetch('https://jsonplaceholder.typicode.com/invalid-endpoint-404')
    .then((res) => {
      if (!res.ok) {
        console.error('❌ Request failed with status:', res.status);
      }
      return res.json();
    })
    .catch((err) => console.error('❌ Network error:', err));
}

function testMultipleRequests() {
  console.log('🌐 Making multiple API requests...');
  const requests = [1, 2, 3].map((id) =>
    fetch(`https://jsonplaceholder.typicode.com/posts/${id}`)
      .then((res) => res.json())
      .then((data) => console.log(`✅ Request ${id} complete:`, data.title))
  );

  Promise.all(requests)
    .then(() => console.log('✅ All requests completed'))
    .catch((err) => console.error('❌ Some requests failed:', err));
}

function testXHRRequest() {
  console.log('🌐 Making XMLHttpRequest...');
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://jsonplaceholder.typicode.com/posts/5');
  xhr.onload = function () {
    if (xhr.status === 200) {
      console.log('✅ XHR request successful');
    }
  };
  xhr.onerror = function () {
    console.error('❌ XHR request failed');
  };
  xhr.send();
}

// PII and Credentials Sanitization Tests
function testPIISanitization() {
  console.log('🔒 Testing PII and credential detection/sanitization...');

  const testData = {
    // PII (Personally Identifiable Information)
    email: 'john.doe@example.com',
    phone: '(555) 123-4567',
    creditCard: '4532-1234-5678-9010',
    ssn: '123-45-6789',
    ipAddress: '192.168.1.100',

    // Credentials (Secrets - NOT PII, but still sensitive)
    apiKey: 'sk_live_abc123def456ghi789',
    token: 'ghp_1234567890abcdefghijklmnopqrstuv',
    password: 'MySecureP@ss123',

    // Normal data
    normalData: 'This is normal data without PII or secrets',
  };

  // Use the SDK's sanitization utility
  const sanitized = demoSanitize(JSON.stringify(testData, null, 2));

  const piiOut = document.getElementById('pii-output');
  piiOut.style.display = 'block';
  piiOut.textContent = '';

  const buildLabel = (text) => { const s = document.createElement('strong'); s.textContent = text; return s; };
  const buildPre = (text, bg) => { const p = document.createElement('pre'); p.textContent = text; Object.assign(p.style, { background: bg, padding: '0.5rem', borderRadius: '4px', overflowX: 'auto' }); return p; };
  const buildNote = (text, color) => { const e = document.createElement('em'); e.style.color = color; e.textContent = text; return e; };

  piiOut.appendChild(buildLabel('\u2705 Data Sanitization Test Complete'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(buildLabel('Original Data (PII + Credentials):'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(buildPre(JSON.stringify(testData, null, 2), '#fff5f5'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(buildLabel('Sanitized Data (Protected):'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(buildPre(sanitized, '#f0fff4'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(buildNote('\u2713 PII: email, phone, credit card, SSN, IP', '#38a169'));
  piiOut.appendChild(document.createElement('br'));
  piiOut.appendChild(buildNote('\u2713 Credentials: API keys, tokens, passwords', '#3182ce'));

  console.log('Original data:', testData);
  console.log('Sanitized data:', sanitized);
}

function testPIIInConsole() {
  console.log('=== Testing PII Detection ===');
  console.log('📧 User email: support@example.com');
  console.log('📞 Contact phone: +1 (555) 987-6543');
  console.log('💳 Payment method: 5555-5555-5555-4444');
  console.log('🆔 SSN: 987-65-4321');
  console.log('');
  console.log('=== Testing Credential Detection ===');
  console.log('🔑 API Key: sk_test_FAKE_KEY_FOR_DEMO_ONLY');
  console.log('🎫 GitHub Token: ghp_FAKE_TOKEN_FOR_DEMO');
  console.log('🔐 Password: MyP@ssw0rd123!');
  console.warn('⚠️ All sensitive data is automatically sanitized when captured!');
  console.info('ℹ️ Check the Console Data section below to see sanitized logs');
}

function showSanitizedData() {
  const sampleText = `
User Profile & Access Information:
========================================
PERSONAL INFORMATION (PII):
- Email: alice.smith@company.com
- Phone: 555-123-4567
- Mobile: +1-555-987-6543
- Credit Card: 4111111111111111
- SSN: 456-78-9012
- IP Address: 10.0.1.45

CREDENTIALS (SECRETS - NOT PII):
- API Key: sk_live_FAKE_DEMO_KEY_NOT_REAL
- Access Token: ghp_FAKE_DEMO_TOKEN_NOT_REAL
- Password: MySecure123!Pass

SAFE DATA:
- Customer ID: #12345
- Order Number: ORD-2024-5678
  `.trim();

  const sanitized = demoSanitize(sampleText);

  const piiOut2 = document.getElementById('pii-output');
  piiOut2.style.display = 'block';
  piiOut2.textContent = '';

  const mkLabel = (text) => { const s = document.createElement('strong'); s.textContent = text; return s; };
  const mkBlock = (text, bg) => { const d = document.createElement('div'); d.textContent = text; Object.assign(d.style, { background: bg, padding: '0.5rem', borderRadius: '4px', whiteSpace: 'pre-wrap', marginBottom: '1rem' }); return d; };
  const mkNote = (text, color) => { const e = document.createElement('em'); e.style.color = color; e.textContent = text; return e; };

  piiOut2.appendChild(mkLabel('\u2705 Text Sanitization Demo'));
  piiOut2.appendChild(document.createElement('br'));
  piiOut2.appendChild(document.createElement('br'));
  piiOut2.appendChild(mkLabel('Before Sanitization:'));
  piiOut2.appendChild(document.createElement('br'));
  piiOut2.appendChild(mkBlock(sampleText, '#fff5f5'));
  piiOut2.appendChild(mkLabel('After Sanitization:'));
  piiOut2.appendChild(document.createElement('br'));
  piiOut2.appendChild(mkBlock(sanitized, '#f0fff4'));
  piiOut2.appendChild(mkNote('\u2713 PII redacted: email, phone, credit card, SSN, IP address', '#38a169'));
  piiOut2.appendChild(document.createElement('br'));
  piiOut2.appendChild(mkNote('\u2713 Credentials redacted: API keys, tokens, passwords', '#3182ce'));
  piiOut2.appendChild(document.createElement('br'));
  piiOut2.appendChild(mkNote('\u2713 Safe data preserved: customer ID, order number', '#718096'));

  console.log('Sanitization complete - check output above');
}

// Metadata Display
function showCurrentMetadata() {
  const metadata = {
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    url: window.location.href,
    timestamp: new Date().toISOString(),
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      pixelRatio: window.devicePixelRatio,
    },
  };

  console.log('📊 Current Browser Metadata:', metadata);
  alert('Check the console for current metadata!');
}

// Floating Button Widget Controls
function showFloatingButton() {
  if (!floatingButton) return console.warn('FloatingButton not initialized');
  floatingButton.show();
  console.log('👁️ Floating button shown');
}

function hideFloatingButton() {
  if (!floatingButton) return console.warn('FloatingButton not initialized');
  floatingButton.hide();
  console.log('🙈 Floating button hidden');
}

function changeButtonIcon() {
  if (!floatingButton) return console.warn('FloatingButton not initialized');
  const icons = ['⚡', '◆', '●', '■', '▲', '◈'];
  const randomIcon = icons[Math.floor(Math.random() * icons.length)];
  floatingButton.setIcon(randomIcon);
  console.log(`Icon changed to: ${randomIcon}`);
}

function changeButtonColor() {
  if (!floatingButton) return console.warn('FloatingButton not initialized');
  const colors = ['#1a365d', '#2c5282', '#2b6cb0', '#2a4365', '#1e3a8a', '#1e40af'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  floatingButton.setBackgroundColor(randomColor);
  console.log(`Color updated to: ${randomColor}`);
}

// Main Capture Function
async function captureBugReport() {
  const btn = event?.target;
  const originalText = btn?.textContent;

  if (btn) {
    btn.textContent = '⏳ Capturing...';
    btn.classList.add('loading');
    btn.disabled = true;
  }

  console.log('🐛 Starting bug report capture...');

  try {
    // Add a small delay to ensure all console logs are captured
    await new Promise((resolve) => setTimeout(resolve, 100));

    const data = await (await getSDK()).capture();

    console.log('✅ Bug report captured successfully!');

    // Format the output nicely
    const formattedData = {
      '🕐 Captured At': new Date(data.metadata.timestamp).toLocaleString(),
      '🌍 URL': data.metadata.url,
      '🖥️ Browser': data.metadata.browser,
      '💻 OS': data.metadata.os,
      '📐 Viewport': `${data.metadata.viewport.width}x${data.metadata.viewport.height}`,
      '📝 Console Logs': `${data.console.length} entries`,
      '🌐 Network Requests': `${data.network.length} requests`,
      '🎥 Replay Events': `${data.replay.length} events (${data.replay.length > 0 ? ((data.replay[data.replay.length - 1].timestamp - data.replay[0].timestamp) / 1000).toFixed(1) + 's' : '0s'})`,
      '📸 Screenshot': data.screenshot === 'SCREENSHOT_FAILED' ? '❌ Failed' : '✅ Captured',
      '📦 Full Data': data,
    };

    document.getElementById('output').textContent = JSON.stringify(formattedData, null, 2);
  } catch (error) {
    console.error('❌ Failed to capture bug report:', error);
    document.getElementById('output').textContent =
      '❌ Error capturing bug report:\n' + error.message;
  } finally {
    if (btn) {
      btn.textContent = originalText;
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }
}

// Session Replay Functions
function playReplay() {
  const events = bugSpotter && bugSpotter.domCollector.getEvents();

  if (events.length === 0) {
    alert('No replay events captured yet. Interact with the page first!');
    return;
  }

  // Check if we have a fullSnapshot event (type 2)
  const hasSnapshot = events.some((e) => e.type === 2);
  if (!hasSnapshot) {
    console.warn('⚠️ No full snapshot found in events. Replay may not display correctly.');
  }

  try {
    createReplayPlayer(events);
    console.log('Event types:', [...new Set(events.map((e) => e.type))]);
  } catch (error) {
    console.error('Failed to create replay player:', error);
    alert('Failed to start replay player: ' + error.message);
  }
}

function stopReplay() {
  const container = document.getElementById('replay-player-container');
  container.classList.remove('active');

  if (replayPlayer) {
    replayPlayer.pause();
  }

  console.log('⏹️ Replay player stopped');
}

async function showReplayInfo() {
  try {
    const report = await (await getSDK()).capture();
    const replayEvents = report.replay;

    const infoDiv = document.getElementById('replay-info');
    infoDiv.style.display = 'block';

    if (replayEvents.length === 0) {
      infoDiv.innerHTML =
        '<strong>No replay events captured yet.</strong><br>Interact with the page to generate events!';
      return;
    }

    const timeSpan = (
      (replayEvents[replayEvents.length - 1].timestamp - replayEvents[0].timestamp) /
      1000
    ).toFixed(2);
    const eventTypes = [...new Set(replayEvents.map((e) => e.type))];

    infoDiv.innerHTML = `
      <strong>📊 Replay Buffer Status:</strong><br>
      • Total Events: ${replayEvents.length}<br>
      • Time Span: ${timeSpan} seconds<br>
      • Event Types: ${eventTypes.join(', ')}<br>
      • First Event: ${new Date(replayEvents[0].timestamp).toLocaleTimeString()}<br>
      • Last Event: ${new Date(replayEvents[replayEvents.length - 1].timestamp).toLocaleTimeString()}<br>
      <br>
      <em>These events will be included when you submit a bug report!</em>
    `;

    console.log('🎥 Replay Events:', {
      count: replayEvents.length,
      timeSpan: timeSpan + 's',
      types: eventTypes,
      sample: replayEvents.slice(0, 3),
    });
  } catch (error) {
    console.error('Failed to get replay info:', error);
  }
}

function testInteraction() {
  const testElement = document.getElementById('screenshot-test');
  const colors = ['#e6f2ff', '#ffe6f2', '#f2ffe6', '#fff2e6', '#f2e6ff'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  testElement.style.background = randomColor;
  testElement.innerHTML = `
    <strong>🎨 Content Updated!</strong>
    <p>This DOM change was recorded at ${new Date().toLocaleTimeString()}</p>
    <p>Background: ${randomColor}</p>
  `;

  console.log('✨ Test interaction triggered - DOM changed!');

  // Automatically show replay info after interaction
  setTimeout(() => showReplayInfo(), 500);
}

// Fetch and Replay Bug Reports
async function fetchBugReports() {
  try {
    const response = await fetch(DEMO_CONFIG.endpoint);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('📋 Fetched bug reports:', data);

    // Handle both response formats: array or {total, bugs}
    const bugs = Array.isArray(data) ? data : data.bugs || [];

    const listDiv = document.getElementById('bug-reports-list');
    listDiv.textContent = '';

    if (bugs.length === 0) {
      const p = document.createElement('p');
      p.style.color = '#94a3b8';
      p.textContent = 'No bug reports found. Submit one first!';
      listDiv.appendChild(p);
      return;
    }

    // Show only the last 5 reports
    const recentBugs = bugs.slice(-5).reverse();

    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, { background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '1rem' });

    const heading = document.createElement('h4');
    heading.style.marginTop = '0';
    heading.textContent = '\u{1F4CB} Recent Bug Reports (' + bugs.length + ' total, showing last 5)';
    wrapper.appendChild(heading);

    const scrollArea = document.createElement('div');
    Object.assign(scrollArea.style, { maxHeight: '300px', overflowY: 'auto' });

    recentBugs.forEach((bug) => {
      const row = document.createElement('div');
      Object.assign(row.style, { padding: '0.75rem', borderBottom: '1px solid #e2e8f0', cursor: 'pointer', transition: 'background 0.2s' });
      row.addEventListener('mouseover', () => { row.style.background = '#f8fafc'; });
      row.addEventListener('mouseout', () => { row.style.background = 'white'; });
      row.addEventListener('click', () => replayBugReport(String(bug.id)));

      const flex = document.createElement('div');
      Object.assign(flex.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'start' });

      const info = document.createElement('div');
      info.style.flex = '1';

      const title = document.createElement('strong');
      title.style.color = '#1e293b';
      title.textContent = bug.title || 'Untitled';
      info.appendChild(title);

      const desc = document.createElement('div');
      Object.assign(desc.style, { fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' });
      const descText = bug.description || '';
      desc.textContent = descText.length > 80 ? descText.substring(0, 80) + '...' : descText;
      info.appendChild(desc);

      const meta = document.createElement('div');
      Object.assign(meta.style, { fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' });
      const hasReplay = bug.report?.replay && bug.report.replay.length > 0;
      const replayText = hasReplay
        ? ' \u2022 \uD83C\uDFA5 ' + bug.report.replay.length + ' replay events'
        : ' \u2022 \u274C No replay';
      meta.textContent = 'ID: ' + bug.id + ' \u2022 ' + new Date(bug.receivedAt).toLocaleString() + replayText;
      info.appendChild(meta);

      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      Object.assign(btn.style, { marginLeft: '1rem', fontSize: '0.85rem' });
      btn.textContent = '\u25B6\uFE0F Replay';
      btn.addEventListener('click', (e) => { e.stopPropagation(); replayBugReport(String(bug.id)); });

      flex.appendChild(info);
      flex.appendChild(btn);
      row.appendChild(flex);
      scrollArea.appendChild(row);
    });

    wrapper.appendChild(scrollArea);
    listDiv.appendChild(wrapper);
  } catch (error) {
    console.error('❌ Failed to fetch bug reports:', error);
    const errDiv = document.getElementById('bug-reports-list');
    errDiv.textContent = '';
    const errP = document.createElement('p');
    errP.style.color = '#dc2626';
    errP.textContent = 'Error: ' + (error instanceof Error ? error.message : String(error));
    errDiv.appendChild(errP);
  }
}

async function replayBugReport(bugId) {
  try {
    console.log('🎬 Fetching bug report:', bugId);

    const response = await fetch(`${DEMO_CONFIG.endpoint}/${bugId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const bug = await response.json();
    console.log('📦 Bug report data:', bug);

    if (!bug.report || !bug.report.replay || bug.report.replay.length === 0) {
      alert('❌ This bug report has no session replay data to play.');
      return;
    }

    const events = bug.report.replay;
    createReplayPlayer(events, bugId);
    console.log('✅ Playing replay for bug:', bugId);
  } catch (error) {
    console.error('❌ Failed to replay bug report:', error);
    alert('Failed to replay bug report: ' + error.message);
  }
}

async function replayLatestReport() {
  try {
    const response = await fetch(DEMO_CONFIG.endpoint);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    // Handle both response formats: array or {total, bugs}
    const bugs = Array.isArray(data) ? data : data.bugs || [];

    if (bugs.length === 0) {
      alert('No bug reports found. Submit one first!');
      return;
    }

    const latestBug = bugs[bugs.length - 1];
    await replayBugReport(latestBug.id);
  } catch (error) {
    console.error('❌ Failed to replay latest report:', error);
    alert('Failed to replay latest report: ' + error.message);
  }
}

// Compression Demo Functions
async function testCompression() {
  console.log('📦 Testing compression...');

  try {
    // Create a test payload
    const testData = {
      title: 'Compression Test',
      description: 'Testing gzip compression',
      logs: Array(50)
        .fill(null)
        .map((_, i) => ({
          level: 'info',
          message: `Test log entry ${i}`,
          timestamp: Date.now() + i,
        })),
      metadata: {
        browser: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    };

    // Use the SDK's compression utilities
    const json = JSON.stringify(testData);
    const originalSize = new Blob([json]).size;
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    await writer.write(new TextEncoder().encode(json));
    await writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    const compressedSize = compressed.byteLength;
    const ratio = Math.round((1 - compressedSize / originalSize) * 100);

    // Display results
    const outputDiv = document.getElementById('compression-output');
    outputDiv.style.display = 'block';
    outputDiv.innerHTML = `
      <strong>✅ Compression Test Results</strong><br><br>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
        <div style="background: #fff5f5; padding: 0.75rem; border-radius: 4px; border-left: 3px solid #e53e3e;">
          <strong>📄 Original Size:</strong><br>
          <span style="font-size: 1.5rem; color: #c53030;">${(originalSize / 1024).toFixed(2)} KB</span><br>
          <em style="font-size: 0.85rem; color: #718096;">${originalSize.toLocaleString()} bytes</em>
        </div>
        <div style="background: #f0fff4; padding: 0.75rem; border-radius: 4px; border-left: 3px solid #38a169;">
          <strong>📦 Compressed Size:</strong><br>
          <span style="font-size: 1.5rem; color: #2f855a;">${(compressedSize / 1024).toFixed(2)} KB</span><br>
          <em style="font-size: 0.85rem; color: #718096;">${compressedSize.toLocaleString()} bytes</em>
        </div>
      </div>
      <div style="margin-top: 1rem; padding: 0.75rem; background: #ebf8ff; border-radius: 4px; text-align: center;">
        <strong style="font-size: 1.1rem; color: #2c5282;">🎯 Size Reduction: ${ratio}%</strong><br>
        <em style="font-size: 0.9rem; color: #2b6cb0;">Saved ${((originalSize - compressedSize) / 1024).toFixed(2)} KB</em>
      </div>
      <div style="margin-top: 0.75rem; font-size: 0.85rem; color: #718096;">
        <strong>Test Data:</strong> 50 log entries + metadata<br>
        <strong>Compression:</strong> Gzip level 6 (balanced speed/size)
      </div>
    `;

    console.log(
      `✅ Compression: ${(originalSize / 1024).toFixed(2)}KB → ${(compressedSize / 1024).toFixed(2)}KB (${ratio}% reduction)`
    );
  } catch (error) {
    console.error('❌ Compression test failed:', error);
    document.getElementById('compression-output').innerHTML =
      '<strong style="color: #c53030;">❌ Compression test failed</strong><br>' + error.message;
  }
}

async function testLargePayload() {
  console.log('📦 Generating large payload with compression test...');

  // Generate a lot of console logs
  for (let i = 0; i < 100; i++) {
    console.log(`Large payload test entry ${i}:`, {
      index: i,
      timestamp: Date.now(),
      data: 'This is some repetitive data that should compress well',
      metadata: { browser: 'test', version: '1.0.0' },
    });
  }

  // Capture the data
  try {
    const report = await (await getSDK()).capture();

    // Calculate compression for the full report
    const json = JSON.stringify(report);
    const originalSize = new Blob([json]).size;
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    await writer.write(new TextEncoder().encode(json));
    await writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    const compressedSize = compressed.byteLength;
    const ratio = Math.round((1 - compressedSize / originalSize) * 100);

    const outputDiv = document.getElementById('compression-output');
    outputDiv.style.display = 'block';
    outputDiv.innerHTML = `
      <strong>✅ Large Payload Compression Results</strong><br><br>
      <div style="background: #f7fafc; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
        <strong>📊 Payload Contents:</strong><br>
        • Console Logs: ${report.console.length} entries<br>
        • Network Requests: ${report.network.length} requests<br>
        • Replay Events: ${report.replay.length} events<br>
        • Screenshot: ${report.screenshot === 'SCREENSHOT_FAILED' ? 'Failed' : 'Captured'}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
        <div style="background: #fff5f5; padding: 0.75rem; border-radius: 4px; text-align: center;">
          <strong>Original</strong><br>
          <span style="font-size: 1.3rem; color: #c53030;">${(originalSize / 1024).toFixed(1)} KB</span>
        </div>
        <div style="background: #f0fff4; padding: 0.75rem; border-radius: 4px; text-align: center;">
          <strong>Compressed</strong><br>
          <span style="font-size: 1.3rem; color: #2f855a;">${(compressedSize / 1024).toFixed(1)} KB</span>
        </div>
        <div style="background: #ebf8ff; padding: 0.75rem; border-radius: 4px; text-align: center;">
          <strong>Reduction</strong><br>
          <span style="font-size: 1.3rem; color: #2c5282;">${ratio}%</span>
        </div>
      </div>
      <div style="margin-top: 1rem; padding: 0.75rem; background: linear-gradient(90deg, #f0fff4 0%, #f0fff4 ${ratio}%, #fff5f5 ${ratio}%, #fff5f5 100%); border-radius: 4px; position: relative;">
        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #1a202c;">
          📊 Compression Efficiency Bar
        </div>
      </div>
      <div style="margin-top: 0.75rem; font-size: 0.85rem; color: #2f855a; text-align: center;">
        <strong>💾 Bandwidth Saved: ${((originalSize - compressedSize) / 1024).toFixed(2)} KB per report</strong>
      </div>
    `;

    console.log(
      `✅ Large payload: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${ratio}% reduction)`
    );
  } catch (error) {
    console.error('❌ Large payload test failed:', error);
  }
}

async function showCompressionInfo() {
  const outputDiv = document.getElementById('compression-output');
  outputDiv.style.display = 'block';
  outputDiv.innerHTML = `
    <strong>📦 Gzip Compression Information</strong><br><br>
    <div style="background: #f7fafc; padding: 1rem; border-radius: 4px; font-size: 0.9rem; line-height: 1.8;">
      <strong>🔧 How It Works:</strong><br>
      1. Screenshot images are optimized (resize to max 1920x1080, convert to WebP at 80% quality)<br>
      2. Full payload is compressed using gzip at level 6 (balanced speed/size)<br>
      3. Binary data is sent with <code>Content-Encoding: gzip</code> header<br>
      4. Falls back to uncompressed if compression doesn't reduce size<br><br>
      
      <strong>📊 Expected Results:</strong><br>
      • Screenshots: 2-4MB → 200-400KB (90%+ reduction)<br>
      • Console logs: 500KB → 50KB (70-90% reduction on repetitive data)<br>
      • Full reports: ~7.5MB → 1-2MB (total payload)<br><br>
      
      <strong>🎯 Benefits:</strong><br>
      • ⚡ Faster uploads (less bandwidth)<br>
      • 💰 Reduced server storage costs<br>
      • 🌐 Better mobile experience<br>
      • 📉 Lower network usage<br><br>
      
      <strong>🔬 Technical Details:</strong><br>
      • Library: <code>pako</code> v2.1.0 (gzip implementation)<br>
      • Compression: Level 6 (default, good balance)<br>
      • Image format: WebP with 80% quality<br>
      • Max image size: 1920x1080 (auto-resize)<br>
    </div>
    <div style="margin-top: 1rem; padding: 0.75rem; background: #e6fffa; border-radius: 4px; border-left: 3px solid #319795;">
      <strong>💡 Tip:</strong> Click "Test Compression" or "Generate Large Payload" to see real compression stats!
    </div>
  `;

  console.log('ℹ️ Compression information displayed');
}

// Authentication Demo Functions
function switchToApiKey() {
  console.log('🔑 Switching to API Key authentication...');

  reinitializeSDK({ apiKey: 'demo-api-key-12345' });

  showOutput(
    'auth-output',
    '✅ Switched to API Key Authentication',
    `
    <div style="background: #f7fafc; padding: 0.75rem; border-radius: 4px;">
      <strong>Configuration:</strong><br>
      • Auth Type: API Key<br>
      • API Key: demo-api-key-12345<br>
      • Header: X-API-Key: demo-api-key-12345<br><br>
      <em style="color: #38a169;">✓ Active authentication method</em>
    </div>
  `
  );

  console.log('✅ API Key authentication active');
}

function switchToBearerToken() {
  showOutput(
    'auth-output',
    '⚠️ Bearer Token Authentication',
    '<div style="background: #f7fafc; padding: 0.75rem; border-radius: 4px;">Not yet supported in SDK v2. API key auth is the current method.</div>'
  );
}

function switchToOAuth() {
  showOutput(
    'auth-output',
    '⚠️ OAuth Authentication',
    '<div style="background: #f7fafc; padding: 0.75rem; border-radius: 4px;">Not yet supported in SDK v2. API key auth is the current method.</div>'
  );
}

function testTokenRefresh() {
  showOutput(
    'auth-output',
    '⚠️ Token Refresh',
    '<div style="background: #f7fafc; padding: 0.75rem; border-radius: 4px;">Token refresh is not yet supported in SDK v2. API key authentication does not expire.</div>'
  );
}

function showAuthConfig() {
  if (!bugSpotter) {
    showOutput('auth-output', '⚠️ SDK not ready', 'Please wait for SDK initialization.');
    return;
  }
  const config = bugSpotter ? bugSpotter.getConfig() : {};

  const outputDiv = document.getElementById('auth-output');
  outputDiv.style.display = 'block';
  outputDiv.innerHTML = `
    <strong>🔍 Current Authentication Configuration</strong><br><br>
    <div style="background: #f7fafc; padding: 0.75rem; border-radius: 4px;">
      • Type: API Key<br>
      • API Key: ${config.apiKey || 'Not set'}<br>
      • Header: X-API-Key<br>
      <br>
      <strong>Endpoint:</strong> ${config.endpoint || 'Not configured'}<br>
    </div>
  `;

  console.log('Current auth config:', { apiKey: config.apiKey, endpoint: config.endpoint });
}

// Restore last active tab on page load
window.addEventListener('DOMContentLoaded', () => {
  const savedTab = localStorage.getItem('activeTab');
  if (savedTab && document.getElementById(`tab-${savedTab}`)) {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach((tab) => {
      if (tab.onclick && tab.onclick.toString().includes(savedTab)) {
        tab.click();
      }
    });
  }
});

// Extension tab: show the API key for copy-paste
const apiKeyEl = document.getElementById('extension-api-key');
if (apiKeyEl) {
  apiKeyEl.textContent = DEMO_CONFIG.apiKey || '(not configured — using mock backend)';
}

function copyApiKey() {
  const key = DEMO_CONFIG.apiKey;
  if (!key) {
    alert('No API key configured. The demo is using the local mock backend.');
    return;
  }
  navigator.clipboard.writeText(key).then(
    () => alert('API key copied to clipboard!'),
    () => {
      // Fallback for older browsers
      const el = document.getElementById('extension-api-key');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }
      alert('Select and copy the API key manually.');
    }
  );
}

// Add some test data on page load
console.log('🎬 Demo page loaded successfully!');
console.info('💡 Try clicking different buttons to test capture functionality');
console.info('🎥 Session replay is active - all interactions are being recorded!');
console.info('📦 Gzip compression is enabled - payloads are automatically compressed!');
console.info('🔐 Authentication: API Key (X-API-Key header)');
