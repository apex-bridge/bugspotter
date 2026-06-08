# ADR-0025: Main-world injection for CSP-proof console/network capture

- Status: Accepted
- Area: capture
- Source: `bugspotter-extension/src/background/service-worker.ts`, `public/main-world-capture.js`
- Date: Console/network capture phase

## Context

Capturing `console`, `fetch`, and `XHR` requires access to the page's JavaScript globals, but content scripts run in an **isolated world** and cannot see page globals. Injecting a `<script>` tag is blocked by strict CSP on banking/finance sites.

## Decision

Register a **main-world** capture script via `chrome.scripting.registerContentScripts` with `world: 'MAIN'` and `runAt: 'document_start'`. It patches `console`, `fetch`, `XHR`, and error handlers, and relays events to the isolated-world content script via `window.postMessage`. `chrome.scripting` bypasses page CSP (a Chrome privilege); `document_start` ensures capture begins before page scripts run.

## Consequences

### Positive

- Works on CSP-strict sites where `<script>` injection fails; captures from the very first page script.
- `postMessage` bridges isolated and main worlds without granting the page access to extension internals.

### Negative / Trade-offs

- The main-world script is **plain JS** (not TypeScript, not bundled) to stay simple, adding ~2KB.
- Duplicate browser `error` events must be de-duplicated within ~2s windows.

## Alternatives considered

- **`<script>` tag injection** — blocked by CSP. Rejected.
- **PerformanceObserver** — timing only, not full network detail. Rejected.
- **Debugger protocol** — unavailable to extensions. Rejected.
