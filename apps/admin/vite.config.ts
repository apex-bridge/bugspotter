import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Get git commit hash from environment variable (set by Docker build arg or CI)
// Falls back to 'unknown' if not set
const getGitCommitHash = () => {
  return process.env.GIT_COMMIT || 'unknown';
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        // Suppress Babel logs in console
        configFile: false,
        babelrc: false,
      },
    }),
  ],
  define: {
    'import.meta.env.VITE_GIT_COMMIT_HASH': JSON.stringify(getGitCommitHash()),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 3001,
    strictPort: true, // Fail if port is already in use
    // Only use proxy in development (when VITE_API_URL not set)
    // E2E tests set VITE_API_URL, so no proxy needed
    proxy: process.env.VITE_API_URL
      ? undefined
      : {
          '/api/': {
            target: 'http://localhost:3000',
            changeOrigin: true,
          },
        },
  },
  build: {
    // Admin panel is feature-rich with i18n, React Query, Tailwind, integrations
    // 1.6MB is reasonable for comprehensive admin UI with all features bundled
    chunkSizeWarningLimit: 2000, // 2MB threshold (default is 500KB)
    rollupOptions: {
      output: {
        // Split vendor dependencies into separate chunk
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-i18n': ['react-i18next', 'i18next'],
        },
      },
    },
  },
});
