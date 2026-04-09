# BugSpotter

> Professional bug reporting SDK with session replay

Capture screenshots, console logs, network requests, **session replays**, and metadata - helping developers reproduce bugs faster.

[![Tests](https://img.shields.io/badge/tests-2136%20passing-brightgreen)]() [![Bundle](https://img.shields.io/badge/bundle-99KB-blue)]() [![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)]() [![Status](https://img.shields.io/badge/status-pre--release-orange)]()

## ✨ Features

| Feature                   | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| 📹 **Session Replay**     | Record and replay user interactions (rrweb)              |
| 🔒 **PII Sanitization**   | Auto-redact emails, phones, cards, SSNs, etc.            |
| 📸 **Screenshots**        | CSP-safe visual capture                                  |
| 📝 **Console Logs**       | Track all console output                                 |
| 🌐 **Network Monitoring** | Capture fetch/XHR with timing                            |
| 🧠 **AI Intelligence**    | Duplicate detection, enrichment, self-service resolution |
| 👨‍💼 **Admin Panel**        | Full web-based control panel (React + TypeScript)        |
| 🎨 **Professional UI**    | Customizable button + modal                              |
| 🔐 **httpOnly Cookies**   | Secure refresh token storage (XSS protection)            |
| 📧 **Notifications**      | Email, Slack, Discord with template system               |
| ⚡ **Lightweight**        | ~99 KB minified                                          |

## 🚀 Quick Start

### Installation

**NPM (Coming Soon)**

```bash
npm install @bugspotter/sdk
# or
yarn add @bugspotter/sdk
# or
pnpm add @bugspotter/sdk
```

**CDN**

```html
<script src="https://unpkg.com/@bugspotter/sdk@latest/dist/bugspotter.min.js"></script>
```

**From Source (Development)**

```bash
# Clone repository
git clone https://github.com/apex-bridge/bugspotter.git
cd bugspotter

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Docker Deployment (Recommended)

```bash
# Copy environment template
cp .env.example .env

# Generate secure secrets
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env

# Start all services (API, worker, PostgreSQL, Redis, MinIO)
pnpm docker:up

# API available at http://localhost:3000
# MinIO Console at http://localhost:9001
```

[Full Docker documentation →](./DOCKER.md)

### Try the Demo

```bash
# Terminal 1: Start backend server
cd packages/backend-mock
node server.js

# Terminal 2: Start demo
cd apps/demo
npx browser-sync start --config bs-config.json
# Visit http://localhost:3000/apps/demo/index.html
```

### Basic Integration

**ES Modules (React, Vue, Angular)**

```javascript
import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: 'bgs_your_api_key',
  endpoint: 'https://api.bugspotter.com',
  showWidget: true,
  replay: { enabled: true, duration: 30 },
  sanitize: { enabled: true, patterns: ['email', 'phone'] },
});
```

**Browser (UMD)**

```html
<script src="https://unpkg.com/@bugspotter/sdk@latest/dist/bugspotter.min.js"></script>
<script>
  BugSpotter.init({
    apiKey: 'bgs_your_api_key',
    endpoint: 'https://api.bugspotter.com',
    showWidget: true,
    replay: { enabled: true, duration: 30 },
    sanitize: { enabled: true, patterns: ['email', 'phone'] },
  });
</script>
```

[View framework-specific examples →](./packages/sdk/docs/FRAMEWORK_INTEGRATION.md)

## 📖 Documentation

| Resource                  | Link                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **System Summary**        | [SYSTEM_SUMMARY.md](./SYSTEM_SUMMARY.md) (comprehensive 2000-word overview)                                                             |
| **Docker Setup**          | [DOCKER.md](./DOCKER.md) (deployment, scaling, troubleshooting)                                                                         |
| **Admin Panel**           | [apps/admin/README.md](./apps/admin/README.md)                                                                                          |
| **SDK API**               | [packages/sdk/README.md](./packages/sdk/README.md)                                                                                      |
| **Framework Integration** | [packages/sdk/docs/FRAMEWORK_INTEGRATION.md](./packages/sdk/docs/FRAMEWORK_INTEGRATION.md) (React, Vue, Angular, Next.js, Nuxt, Svelte) |
| **SDK Publishing**        | [packages/sdk/docs/PUBLISHING.md](./packages/sdk/docs/PUBLISHING.md) (CI/CD, versioning, npm release)                                   |
| **Backend API**           | [packages/backend/README.md](./packages/backend/README.md)                                                                              |
| **Session Replay**        | [packages/sdk/docs/SESSION_REPLAY.md](./packages/sdk/docs/SESSION_REPLAY.md)                                                            |
| **Notifications**         | [apps/admin/NOTIFICATION_E2E_TESTS.md](./apps/admin/NOTIFICATION_E2E_TESTS.md) (setup & E2E tests)                                      |
| **Test Services**         | [SETUP_TEST_SERVICES.md](./SETUP_TEST_SERVICES.md) (Gmail, Slack, Discord setup)                                                        |
| **Plugin System**         | [packages/backend/src/integrations/PLUGIN_SYSTEM.md](./packages/backend/src/integrations/PLUGIN_SYSTEM.md)                              |
| **Security**              | [packages/backend/SECURITY.md](./packages/backend/SECURITY.md)                                                                          |
| **Admin Security**        | [apps/admin/SECURITY.md](./apps/admin/SECURITY.md) (httpOnly cookies, CSP)                                                              |
| **Testing**               | [packages/backend/TESTING.md](./packages/backend/TESTING.md)                                                                            |
| **Contributing**          | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                                                                    |

## 🎬 Session Replay

\`\`\`javascript
replay: {
enabled: true,
duration: 30, // Keep last 30 seconds
sampling: {
mousemove: 50, // Throttle to 50ms
scroll: 100 // Throttle to 100ms
}
}
\`\`\`

[Learn more →](./packages/sdk/docs/SESSION_REPLAY.md)

## 🔒 PII Sanitization

Auto-redact sensitive data before submission:

\`\`\`javascript
sanitize: {
enabled: true,
patterns: ['email', 'phone', 'creditcard', 'ssn', 'iin', 'ip'],
customPatterns: [
{ name: 'api-key', regex: /API[-_]KEY:\s\*[\w-]{20,}/gi }
]
}
\`\`\`

**Supported:** Emails, phones, credit cards, SSNs, Kazakhstan IIN/BIN, IP addresses, custom patterns

## 📦 Project Structure

**pnpm workspace monorepo:**

- `packages/sdk` - Core TypeScript SDK (~99KB)
- `packages/backend` - Fastify REST API with PostgreSQL
- `packages/types` - Shared TypeScript definitions
- `packages/backend-mock` - Mock API server
- `apps/demo` - Interactive demo

## 🧪 Testing

**SDK:** 414 tests (412 passing, 2 failing) - unit + E2E + Playwright  
**Backend:** 2,586 tests (all passing ✅) - unit + integration + queue + load + storage + notifications  
**Admin:** 94 tests (all passing ✅) - unit + E2E with Playwright  
**Total:** 3,094 tests - 3,092 passing ✅ (2 SDK E2E failures)

Testing uses Testcontainers for zero-setup database and Redis testing.

```bash
pnpm test              # All tests (requires Docker)
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
```

## 🏗️ Tech Stack

**SDK:** TypeScript, Webpack, rrweb  
**Backend:** Fastify 5.6.1, PostgreSQL 16, S3-compatible storage  
**Testing:** Vitest, Testcontainers  
**Dev:** pnpm, ESLint, Prettier

## 📊 Performance

- **SDK Bundle:** ~99 KB minified
- **Admin Bundle:** ~308 KB (JS) + ~15 KB (CSS) gzipped
- **Load Time:** <100ms (SDK), <2s (Admin)
- **Memory:** <15 MB (30s replay buffer)
- **API Response:** <200ms (p95)
- **Tests:** 2,705 total (2,703 passing ✅)

## 🛣️ Roadmap

✅ **Completed:**

- Core SDK with session replay (rrweb)
- PII sanitization (10+ patterns)
- Backend API with PostgreSQL & S3 storage
- Admin control panel (React + TypeScript)
- httpOnly cookie authentication (XSS protection)
- Notification system (Email, Slack, Discord with templates)
- AI intelligence integration (duplicate detection, enrichment, self-service resolution)
- Per-tenant intelligence feature flags and API key provisioning
- Comprehensive testing (2,003+ tests)

🚧 **In Progress (Pre-Release):**

- Production deployment guides
- API documentation finalization
- Performance optimization

⏳ **Planned for v1.0:**

- NPM package release (prepared, awaiting first publish)
- ✅ Framework integrations guide (React, Vue, Angular, Next.js, Nuxt, Svelte)
- Hosted backend service
- Analytics dashboard
- Source map support
- Real-time error tracking

## 🤝 Contributing

\`\`\`bash
git checkout -b feature/amazing-feature
pnpm test
git commit -m "feat: add amazing feature"
\`\`\`

## 📄 License

[FSL-1.1-Apache-2.0](./LICENSE.md) — Copyright (c) 2024-2026 Apex Bridge Technology LLP

Free to use, modify, and self-host. Cannot be used to build a competing SaaS. Becomes Apache 2.0 on April 9, 2028.

The SDK ([@bugspotter/sdk](https://github.com/apex-bridge/bugspotter-sdk)) is MIT licensed.

## 📞 Support

- 📧 Email: support@apexbridge.tech
- 🐛 Issues: [GitHub Issues](https://github.com/apex-bridge/bugspotter/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/apex-bridge/bugspotter/discussions)
- 🌐 Website: [apexbridge.tech](https://apexbridge.tech)

## 📚 Documentation Structure

BugSpotter maintains a clean documentation hierarchy:

**Root Level** (Essential docs only):

- `README.md` - Project overview, quick start, feature highlights
- `SYSTEM_SUMMARY.md` - Comprehensive 2000-word system documentation
- `CHANGELOG.md` - Version history and release notes
- `CONTRIBUTING.md` - Contribution guidelines and workflow

**Package Level**:

- `apps/admin/` - Admin panel docs (README, SECURITY, REACT_PATTERNS)
- `packages/backend/` - Backend API docs (README, SECURITY, TESTING, EMAIL_INTEGRATION)
- `packages/sdk/` - SDK usage guide and session replay docs
- `packages/types/` - Shared type definitions
- `packages/backend-mock/` - Mock API server for development

**Guides** (`docs/`):

- `docs/INTELLIGENCE_INTEGRATION_GUIDE.md` - AI intelligence architecture, API, configuration, and feature flags

**Module Level**:

- `packages/backend/src/queue/` - Queue system documentation
- `packages/backend/src/storage/` - Storage layer documentation
- `packages/backend/src/retention/` - Retention policy documentation
- `packages/backend/src/integrations/` - Plugin system and integration docs

---

Made with ⚡ by [ApexBridge](https://apexbridge.tech)
