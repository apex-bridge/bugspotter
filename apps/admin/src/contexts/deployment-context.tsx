import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { API_ENDPOINTS } from '../lib/api-constants';

interface DeploymentFeatures {
  multiTenancy: boolean;
  billing: boolean;
  usageTracking: boolean;
  quotaEnforcement: boolean;
}

interface DeploymentConfig {
  mode: 'selfhosted' | 'saas';
  features: DeploymentFeatures;
  loaded: boolean;
}

const DEFAULT_CONFIG: DeploymentConfig = {
  mode: 'saas',
  features: { multiTenancy: true, billing: true, usageTracking: true, quotaEnforcement: true },
  loaded: false,
};

const DeploymentContext = createContext<DeploymentConfig>(DEFAULT_CONFIG);

function getApiBaseUrl(): string {
  const runtime = window.__RUNTIME_CONFIG__;
  return runtime?.apiUrl || import.meta.env.VITE_API_URL || '';
}

export function DeploymentProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<DeploymentConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    const controller = new AbortController();
    const baseUrl = getApiBaseUrl();

    fetch(`${baseUrl}${API_ENDPOINTS.deployment()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data?.mode && json?.data?.features) {
          setConfig({
            mode: json.data.mode,
            features: { ...DEFAULT_CONFIG.features, ...json.data.features },
            loaded: true,
          });
        } else {
          setConfig((prev) => ({ ...prev, loaded: true }));
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (import.meta.env.DEV) {
          console.warn('Failed to load deployment config, falling back to SaaS defaults.', error);
        }
        setConfig((prev) => ({ ...prev, loaded: true }));
      });

    return () => {
      controller.abort();
    };
  }, []);

  return <DeploymentContext.Provider value={config}>{children}</DeploymentContext.Provider>;
}

export function useDeployment(): DeploymentConfig {
  return useContext(DeploymentContext);
}

export function useIsSaaS(): boolean {
  return useDeployment().mode === 'saas';
}
