import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface PermissionDeniedProps {
  resource: string;
  action?: string;
  message?: string;
}

export function PermissionDenied({ resource, action = 'access', message }: PermissionDeniedProps) {
  const defaultMessage = `You don't have permission to ${action} ${resource}. Please contact your administrator to request access.`;

  return (
    <Card className="border-yellow-200 bg-yellow-50">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" aria-hidden="true" />
          <CardTitle className="text-yellow-900">Permission Denied</CardTitle>
        </div>
        <CardDescription className="text-yellow-700">
          {message || defaultMessage}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-yellow-600">
        <p>Required permission: {action} {resource}</p>
      </CardContent>
    </Card>
  );
}
