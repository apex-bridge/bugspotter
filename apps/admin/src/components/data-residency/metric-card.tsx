import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function MetricCard({ label, value, className }: MetricCardProps) {
  return (
    <div className={cn('p-4 bg-gray-50 rounded-lg', className)}>
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
