import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/auth-context';
import { isPlatformAdmin } from '../types';

export function DefaultRedirect() {
  const { user } = useAuth();

  // Redirect platform admin users to dashboard, others to projects
  const redirectTo = isPlatformAdmin(user) ? '/dashboard' : '/projects';

  return <Navigate to={redirectTo} replace />;
}
