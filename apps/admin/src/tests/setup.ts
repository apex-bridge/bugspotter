import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import en from '../i18n/locales/en.json';

// Global i18n mock — resolves keys from actual EN translations.
// Individual tests can override with their own vi.mock('react-i18next').
function resolveKey(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  return typeof current === 'string' ? current : path;
}

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, string | number>) => {
        let result = resolveKey(en, key);
        if (params && typeof result === 'string') {
          Object.entries(params).forEach(([k, v]) => {
            result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), () => String(v));
          });
        }
        return result;
      },
      i18n: { language: 'en', changeLanguage: vi.fn().mockResolvedValue('en') },
    }),
    Trans: ({
      i18nKey,
      values,
      children,
    }: {
      i18nKey?: string;
      values?: Record<string, string | number>;
      children?: unknown;
    }) => {
      if (i18nKey) {
        let result = resolveKey(en, i18nKey);
        if (values && typeof result === 'string') {
          Object.entries(values).forEach(([k, v]) => {
            result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), () => String(v));
          });
        }
        // Strip HTML tags for plain text rendering in tests
        return typeof result === 'string' ? result.replace(/<[^>]*>/g, '') : result;
      }
      return children;
    },
  };
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// Configure base URL for fetch in test environment
// This ensures relative URLs work with MSW in happy-dom
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'location', {
    value: {
      origin: 'http://localhost:3000',
      protocol: 'http:',
      host: 'localhost:3000',
      hostname: 'localhost',
      port: '3000',
      pathname: '/',
      search: '',
      hash: '',
      href: 'http://localhost:3000/',
    },
    writable: true,
  });
}
