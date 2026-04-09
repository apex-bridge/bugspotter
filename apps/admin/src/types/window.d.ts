// Extend the global Window interface to include runtime configuration
// This config is injected by docker-entrypoint.sh into /config.js at container startup

interface Window {
  __RUNTIME_CONFIG__?: {
    apiUrl?: string;
    gitCommit?: string;
  };
}
