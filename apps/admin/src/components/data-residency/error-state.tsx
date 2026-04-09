import { AlertTriangle } from 'lucide-react';
import { Alert } from '../ui/alert';

interface ErrorStateProps {
  title: string;
  message: string;
}

export function ErrorState({ title, message }: ErrorStateProps) {
  return (
    <div className="p-8">
      <Alert variant="destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm">{message}</p>
        </div>
      </Alert>
    </div>
  );
}
