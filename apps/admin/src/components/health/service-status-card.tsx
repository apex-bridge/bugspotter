import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { LucideIcon } from 'lucide-react';
import type { ServiceHealth } from '@bugspotter/types';

interface ServiceStatusCardProps {
  title: string;
  icon: LucideIcon;
  service: ServiceHealth | undefined;
  getStatusColor: (status: string) => string;
}

export function ServiceStatusCard({
  title,
  icon: Icon,
  service,
  getStatusColor,
}: ServiceStatusCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-bold ${getStatusColor(service?.status || '')}`}
          role="status"
        >
          {service?.status?.toUpperCase() || 'UNKNOWN'}
          <span className="sr-only">
            {service?.status === 'up'
              ? 'operational'
              : service?.status === 'down'
                ? 'down'
                : 'status unknown'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Response: {service?.response_time != null ? `${service.response_time}ms` : 'N/A'}
        </p>
        {service?.error && <p className="text-xs text-red-600 mt-1">{service.error}</p>}
      </CardContent>
    </Card>
  );
}
