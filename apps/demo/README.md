# BugSpotter Demo

Interactive demonstration showcasing all SDK features including session replay.

## 🚀 Quick Start

```bash
# Terminal 1: Start backend (required for submissions)
cd packages/backend-mock && node server.js

# Terminal 2: Start demo
cd apps/demo
npx browser-sync start --server --files "*.html,*.css,*.js" --port 3000
```

**Visit:** http://localhost:3000

## 📁 Structure

```
apps/demo/
├── index.html          # HTML structure (256 lines)
├── styles.css          # All styles (5.4 KB)
├── demo.js             # All logic (38 KB)
├── bugspotter.min.js   # SDK bundle (176 KB)
└── bs-config.json      # Dev server config
```

## ✨ Features

## ✨ Features

| Tab             | Features                                              |
| --------------- | ----------------------------------------------------- |
| 📸 **Capture**  | Console logs, network requests, screenshots, metadata |
| 🎥 **Replay**   | Live session playback, fetch reports, rrweb player    |
| 🔒 **Security** | PII sanitization, credential redaction                |
| ⚙️ **Advanced** | Auth methods (API Key, Bearer, OAuth), compression    |
| 🎨 **UI**       | Floating button, modal customization                  |

## 🛠️ Development

**Auto-reload enabled** - changes to `.html`, `.css`, `.js` files reload automatically.

### Modifying the Demo

- **Styles**: Edit `styles.css`
- **Logic**: Edit `demo.js`
- **Structure**: Edit `index.html`

### Code Quality

Refactored for maintainability with:

- ✅ Separation of concerns (HTML/CSS/JS)
- ✅ Reusable helper functions
- ✅ Eliminated ~170 lines of duplication

**Helper Functions:**

- `submitBugReport()` - Centralized API submission
- `createReplayPlayer()` - Unified rrweb player creation
- `reinitializeSDK()` - SDK reinitialization
- `showOutput()` - Formatted console output

## 🎮 Testing Workflow

1. **Interact with page** - Click buttons, scroll, change tabs
2. **Submit bug** - Use ⚡ floating button or Capture tab
3. **View reports** - Replay tab → "📋 Fetch Bug Reports"
4. **Play replay** - Click any report with 🎥 replay events

**Tip:** Bugs with "❌ No Replay" were submitted without user interactions.
