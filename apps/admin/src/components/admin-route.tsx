import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/auth-context';

interface AdminRouteProps {
  children: React.ReactNode;
}

/**
 * Admin-only route protection
 * Redirects non-admin users to projects page
 */
export function AdminRoute({ children }: AdminRouteProps) {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    // Redirect non-admin users to projects (accessible to all)
    return <Navigate to="/projects" replace />;
  }

  return <>{children}</>;
}
