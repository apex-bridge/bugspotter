import { ReactNode } from 'react';

interface PolicyDetailItemProps {
  label: string;
  value: ReactNode;
}

export function PolicyDetailItem({ label, value }: PolicyDetailItemProps) {
  return (
    <div>
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
