import { Navigate } from 'react-router-dom';
import { useDeployment } from '../contexts/deployment-context';

interface SaaSRouteProps {
  children: React.ReactNode;
}

/**
 * SaaS-only route protection.
 * Renders nothing until deployment config is loaded.
 * Redirects to projects page in self-hosted deployments.
 */
export function SaaSRoute({ children }: SaaSRouteProps) {
  const { mode, loaded } = useDeployment();

  if (!loaded) {
    return null;
  }

  if (mode !== 'saas') {
    return <Navigate to="/projects" replace />;
  }

  return <>{children}</>;
}
