import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Copy, Eye, RotateCw, Trash2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../utils/format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import type { ApiKey, Project } from '../../types';
import type { ApiKeyStatus } from '@bugspotter/types';

// ============================================================================
// CONSTANTS
// ============================================================================

const TABLE_CELL_CLASS = 'px-6 py-4 whitespace-nowrap';
const TABLE_HEADER_CLASS =
  'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';

const STATUS_BADGE_CONFIG: Record<
  ApiKeyStatus,
  { labelKey: string; className: string; icon?: React.ReactNode }
> = {
  active: {
    labelKey: 'apiKeys.table.statusActive',
    className: 'bg-green-100 text-green-800',
  },
  expiring: {
    labelKey: 'apiKeys.table.statusExpiring',
    className: 'bg-yellow-100 text-yellow-800',
    icon: <AlertCircle className="w-3 h-3 mr-1" aria-hidden="true" />,
  },
  expired: {
    labelKey: 'apiKeys.table.statusExpired',
    className: 'bg-red-100 text-red-800',
  },
  revoked: {
    labelKey: 'apiKeys.table.statusRevoked',
    className: 'bg-gray-100 text-gray-800',
  },
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * Status badge component
 */
function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const { t } = useTranslation();
  const config = STATUS_BADGE_CONFIG[status] || {
    labelKey: 'apiKeys.table.statusActive',
    className: 'bg-gray-100 text-gray-800',
  };

  const label = t(config.labelKey);

  return (
    <span
      role="status"
      aria-label={t('apiKeys.table.statusLabel', { status: label })}
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {label}
    </span>
  );
}

/**
 * Empty state component
 */
function EmptyState() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardContent className="p-12 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
            <Copy className="w-8 h-8 text-gray-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t('apiKeys.table.noApiKeys')}</h3>
            <p className="text-gray-500 mt-1">{t('apiKeys.table.noApiKeysDescription')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Table header component
 */
function TableHeader() {
  const { t } = useTranslation();
  const headers = [
    t('apiKeys.table.name'),
    t('apiKeys.table.keyPrefix'),
    t('apiKeys.table.status'),
    t('apiKeys.table.project'),
    t('apiKeys.table.permissions'),
    t('apiKeys.table.expires'),
    t('apiKeys.table.lastUsed'),
    t('apiKeys.table.actions'),
  ];

  return (
    <thead className="bg-gray-50 border-b border-gray-200">
      <tr>
        {headers.map((header, index) => (
          <th
            key={header}
            scope="col"
            className={`${TABLE_HEADER_CLASS} ${index === headers.length - 1 ? 'text-right' : ''}`}
          >
            {header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

interface CopyButtonProps {
  keyPrefix: string;
  apiKeyId: string;
  isCopied: boolean;
  onCopy: (keyPrefix: string, id: string) => void;
}

/**
 * Copy button with visual feedback
 */
function CopyButton({ keyPrefix, apiKeyId, isCopied, onCopy }: CopyButtonProps) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onCopy(keyPrefix, apiKeyId)}
      aria-label={t('apiKeys.table.copyKeyPrefix', { keyPrefix })}
    >
      {isCopied ? (
        <>
          <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
          <span className="sr-only">{t('apiKeys.showDialog.copied')}</span>
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">{t('apiKeys.showDialog.copy')}</span>
        </>
      )}
    </Button>
  );
}

interface TableRowProps {
  apiKey: ApiKey;
  projectName: string;
  isCopied: boolean;
  isLoading: boolean;
  readOnly?: boolean;
  onCopy: (keyPrefix: string, id: string) => void;
  onViewUsage: (id: string) => void;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
}

/**
 * Table row component for a single API key
 */
function TableRow({
  apiKey,
  projectName,
  isCopied,
  isLoading,
  readOnly,
  onCopy,
  onViewUsage,
  onRotate,
  onRevoke,
}: TableRowProps) {
  const { t } = useTranslation();

  return (
    <tr className="hover:bg-gray-50">
      {/* Name */}
      <td className={TABLE_CELL_CLASS}>
        <div className="text-sm font-medium text-gray-900">{apiKey.name}</div>
      </td>

      {/* Key Prefix */}
      <td className={TABLE_CELL_CLASS}>
        <div className="flex items-center gap-2">
          <code className="text-sm text-gray-600 font-mono">{apiKey.key_prefix}...</code>
          <CopyButton
            keyPrefix={apiKey.key_prefix}
            apiKeyId={apiKey.id}
            isCopied={isCopied}
            onCopy={onCopy}
          />
        </div>
      </td>

      {/* Status */}
      <td className={TABLE_CELL_CLASS}>
        <StatusBadge status={apiKey.status} />
      </td>

      {/* Project */}
      <td className={TABLE_CELL_CLASS}>
        <div className="text-sm text-gray-900">{projectName}</div>
      </td>

      {/* Permissions */}
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1">
          {apiKey.permissions.length > 0 ? (
            apiKey.permissions.map((permission) => (
              <span
                key={permission}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
              >
                {permission}
              </span>
            ))
          ) : apiKey.permission_scope ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
              {apiKey.permission_scope}
            </span>
          ) : null}
        </div>
      </td>

      {/* Expires */}
      <td className={TABLE_CELL_CLASS}>
        <div className="text-sm text-gray-500">
          {apiKey.expires_at ? formatDate(apiKey.expires_at) : t('apiKeys.table.never')}
        </div>
      </td>

      {/* Last Used */}
      <td className={TABLE_CELL_CLASS}>
        <div className="text-sm text-gray-500">
          {apiKey.last_used_at ? formatDate(apiKey.last_used_at) : t('apiKeys.table.never')}
        </div>
      </td>

      {/* Actions */}
      <td className={`${TABLE_CELL_CLASS} text-right`}>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewUsage(apiKey.id)}
            aria-label={t('apiKeys.table.viewUsage', { name: apiKey.name })}
          >
            <Eye className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRotate(apiKey.id)}
            disabled={isLoading || readOnly}
            aria-label={t('apiKeys.table.rotateKey', { name: apiKey.name })}
          >
            <RotateCw className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRevoke(apiKey.id)}
            disabled={isLoading || readOnly}
            aria-label={t('apiKeys.table.revokeKey', { name: apiKey.name })}
          >
            <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmClassName?: string;
}

/**
 * Reusable confirmation dialog
 */
function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmClassName,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('apiKeys.table.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={confirmClassName}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface ApiKeyTableProps {
  apiKeys: ApiKey[];
  projects: Project[];
  onRevoke: (id: string) => void;
  onRotate: (id: string) => void;
  onViewUsage: (id: string) => void;
  isLoading: boolean;
  readOnly?: boolean;
}

export function ApiKeyTable({
  apiKeys,
  projects,
  onRevoke,
  onRotate,
  onViewUsage,
  isLoading,
  readOnly,
}: ApiKeyTableProps) {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeDialogId, setRevokeDialogId] = useState<string | null>(null);
  const [rotateDialogId, setRotateDialogId] = useState<string | null>(null);

  // Use Map for O(1) project name lookups instead of O(n) array.find()
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  // Helper to get project names from allowed_projects array
  const getProjectNames = useCallback(
    (allowedProjects: string[] | null): string => {
      if (!allowedProjects || allowedProjects.length === 0) {
        return t('apiKeys.table.allProjects');
      }

      const projectNames = allowedProjects
        .map((id) => projectMap.get(id))
        .filter((name): name is string => name !== undefined);

      if (projectNames.length === 0) {
        return t('apiKeys.table.unknown');
      }

      if (projectNames.length === 1) {
        return projectNames[0];
      }

      // Multiple projects: show first + count
      return `${projectNames[0]} +${projectNames.length - 1}`;
    },
    [projectMap, t]
  );

  const handleCopy = useCallback(
    async (keyPrefix: string, id: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(keyPrefix);
        setCopiedId(id);
        toast.success(t('apiKeys.table.keyPrefixCopied'));
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        toast.error(t('errors.failedToCopyToClipboard'));
      }
    },
    [t]
  );

  const handleRevokeConfirm = useCallback((): void => {
    if (revokeDialogId) {
      onRevoke(revokeDialogId);
      setRevokeDialogId(null);
    }
  }, [revokeDialogId, onRevoke]);

  const handleRotateConfirm = useCallback((): void => {
    if (rotateDialogId) {
      onRotate(rotateDialogId);
      setRotateDialogId(null);
    }
  }, [rotateDialogId, onRotate]);

  if (apiKeys.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">{t('apiKeys.table.tableCaption')}</caption>
              <TableHeader />
              <tbody className="bg-white divide-y divide-gray-200">
                {apiKeys.map((apiKey) => (
                  <TableRow
                    key={apiKey.id}
                    apiKey={apiKey}
                    projectName={getProjectNames(apiKey.allowed_projects)}
                    isCopied={copiedId === apiKey.id}
                    isLoading={isLoading}
                    readOnly={readOnly}
                    onCopy={handleCopy}
                    onViewUsage={onViewUsage}
                    onRotate={setRotateDialogId}
                    onRevoke={setRevokeDialogId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Revoke Confirmation */}
      <ConfirmDialog
        isOpen={revokeDialogId !== null}
        onClose={() => setRevokeDialogId(null)}
        onConfirm={handleRevokeConfirm}
        title={t('apiKeys.table.revokeDialogTitle')}
        description={t('apiKeys.table.revokeDialogDescription')}
        confirmLabel={t('apiKeys.table.revokeConfirm')}
        confirmClassName="bg-red-600 hover:bg-red-700"
      />

      {/* Rotate Confirmation */}
      <ConfirmDialog
        isOpen={rotateDialogId !== null}
        onClose={() => setRotateDialogId(null)}
        onConfirm={handleRotateConfirm}
        title={t('apiKeys.table.rotateDialogTitle')}
        description={t('apiKeys.table.rotateDialogDescription')}
        confirmLabel={t('apiKeys.table.rotateConfirm')}
      />
    </>
  );
}
