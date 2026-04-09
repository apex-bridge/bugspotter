import { Clock, Ban, AlertTriangle } from 'lucide-react';
import type { ViolationEntry } from '../../services/data-residency-service';
import { formatDate } from '../../utils/format';

interface ViolationItemProps {
  violation: ViolationEntry;
}

export function ViolationItem({ violation }: ViolationItemProps) {
  return (
    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
      {violation.blocked ? (
        <Ban className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      ) : (
        <AlertTriangle
          className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
      )}
      <div className="flex-1">
        <div className="font-medium text-gray-900">{violation.type}</div>
        <div className="text-gray-700">{violation.description}</div>
        <div className="text-gray-500 text-xs mt-1 flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {formatDate(violation.createdAt)}
        </div>
      </div>
    </div>
  );
}
