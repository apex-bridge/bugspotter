import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Code2, Trash2, Clock, TrendingUp, AlertCircle } from 'lucide-react';

type IntegrationStatus = 'not_configured' | 'active' | 'error' | 'disabled';

interface IntegrationStats {
  last_sync_at?: string | Date;
  total?: number;
  success?: number;
  failed?: number;
  avg_duration_ms?: number;
}

interface Integration {
  type: string;
  name: string;
  status: IntegrationStatus;
  stats?: IntegrationStats;
  is_custom?: boolean;
}

interface Props {
  integration: Integration;
  onDelete: (type: string) => void;
  onEditCode?: (type: string) => void;
}

const statusConfig = (s: IntegrationStatus) => {
  switch (s) {
    case 'active':
      return { label: 'Active', variant: 'default' as const };
    case 'error':
      return { label: 'Error', variant: 'destructive' as const };
    case 'disabled':
      return { label: 'Disabled', variant: 'secondary' as const };
    default:
      return { label: 'Not Configured', variant: 'outline' as const };
  }
};

const calculateSuccessRate = (stats?: IntegrationStats): string => {
  if (!stats?.total) {
    return '0%';
  }
  const rate = ((stats.success ?? 0) / stats.total) * 100;
  return `${Math.round(rate)}%`;
};

export const IntegrationCard: React.FC<Props> = ({ integration, onDelete, onEditCode }) => {
  const { t } = useTranslation();
  const { type, name, status, stats, is_custom } = integration;
  const statusInfo = statusConfig(status);
  const hasStats = stats && (stats.total ?? 0) > 0;
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleDeleteClick = () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }
    onDelete(type);
    setIsConfirmingDelete(false);
  };

  const handleCancelDelete = () => {
    setIsConfirmingDelete(false);
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              {name?.[0]?.toUpperCase()}
            </div>
            <div>
              <CardTitle className="text-base">{name}</CardTitle>
              <CardDescription className="text-xs font-mono">{type}</CardDescription>
            </div>
          </div>
          <Badge variant={statusInfo.variant} className="text-xs">
            {statusInfo.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-3">
        {/* Stats Section */}
        {hasStats ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
              <div>
                <div className="text-xs text-gray-500">{t('integrationConfig.lastSync')}</div>
                <div className="font-medium text-xs">
                  {stats?.last_sync_at
                    ? new Date(stats.last_sync_at).toLocaleDateString('en-CA')
                    : t('integrationConfig.never')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
              <div>
                <div className="text-xs text-gray-500">{t('integrationConfig.successRate')}</div>
                <div className="font-medium text-xs">{calculateSuccessRate(stats)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-gray-500 py-1">
            <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="text-xs">{t('integrationConfig.noSyncActivity')}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-1.5 pt-2 border-t">
          {is_custom && onEditCode && (
            <Button
              size="sm"
              onClick={() => onEditCode(type)}
              data-testid="edit-code-button"
              aria-label={`Edit custom plugin code for ${name}`}
              className="flex-1 h-8 text-xs"
            >
              <Code2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              {t('integrationConfig.editCode')}
            </Button>
          )}
          {!isConfirmingDelete ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeleteClick}
              data-testid="delete-integration-button"
              aria-label={`Delete ${name} integration`}
              aria-describedby={`delete-warning-${type}`}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              {t('integrationConfig.delete')}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteClick}
                data-testid="confirm-delete-button"
                aria-label={`Confirm deletion of ${name} integration`}
                className="flex-1 h-8 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                {t('integrationConfig.confirmDelete')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancelDelete}
                aria-label="Cancel deletion"
                className="h-8 text-xs"
              >
                {t('integrationConfig.cancel')}
              </Button>
            </>
          )}
          <span id={`delete-warning-${type}`} className="sr-only">
            Warning: Deleting this integration will remove all configuration and cannot be undone.
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default IntegrationCard;
