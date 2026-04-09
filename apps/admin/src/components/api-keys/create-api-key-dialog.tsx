import { useState, useCallback, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import { Checkbox } from '../ui/checkbox';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { PermissionScope, ApiKeyType } from '@bugspotter/types';
import type { Project, ApiKeyResponse, CreateApiKeyData } from '../../types';

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateApiKeyData) => Promise<ApiKeyResponse>;
  projects: Project[];
  isLoading: boolean;
}

const DEFAULT_PERMISSIONS = ['reports:write', 'sessions:write'] as const;

const PERMISSION_OPTIONS = [
  { id: 'reports:read', labelKey: 'apiKeys.createDialog.permissionReadReports' },
  { id: 'reports:write', labelKey: 'apiKeys.createDialog.permissionWriteReports' },
  { id: 'reports:update', labelKey: 'apiKeys.createDialog.permissionUpdateReports' },
  { id: 'reports:delete', labelKey: 'apiKeys.createDialog.permissionDeleteReports' },
  { id: 'sessions:read', labelKey: 'apiKeys.createDialog.permissionReadSessions' },
  { id: 'sessions:write', labelKey: 'apiKeys.createDialog.permissionWriteSessions' },
] as const;

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onSubmit,
  projects,
  isLoading,
}: CreateApiKeyDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState<ApiKeyType>('development');
  const [permissionScope, setPermissionScope] = useState<PermissionScope>('write');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>(Array.from(DEFAULT_PERMISSIONS));
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState<number | undefined>(undefined);
  const [rateLimitPerHour, setRateLimitPerHour] = useState<number | undefined>(undefined);
  const [rateLimitPerDay, setRateLimitPerDay] = useState<number | undefined>(undefined);
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName('');
      setType('development');
      setPermissionScope('write');
      setSelectedProjects([]);
      setPermissions(Array.from(DEFAULT_PERMISSIONS));
      setAllowedOrigins([]);
      setRateLimitPerMinute(undefined);
      setRateLimitPerHour(undefined);
      setRateLimitPerDay(undefined);
      setExpiresAt(undefined);
    }
  }, [open]);

  const handlePermissionToggle = useCallback((permissionId: string): void => {
    setPermissions((prev) =>
      prev.includes(permissionId) ? prev.filter((p) => p !== permissionId) : [...prev, permissionId]
    );
  }, []);

  const handleProjectToggle = useCallback((projectId: string): void => {
    setSelectedProjects((prev) =>
      prev.includes(projectId) ? prev.filter((p) => p !== projectId) : [...prev, projectId]
    );
  }, []);

  const validateForm = useCallback((): boolean => {
    if (!name.trim()) {
      toast.error(t('errors.enterApiKeyName'));
      return false;
    }

    if (selectedProjects.length === 0) {
      toast.error(t('errors.selectAtLeastOneProject'));
      return false;
    }

    if (permissionScope === 'custom' && permissions.length === 0) {
      toast.error(t('errors.selectAtLeastOnePermission'));
      return false;
    }

    return true;
  }, [name, selectedProjects, permissionScope, permissions, t]);

  const buildFormData = useCallback((): CreateApiKeyData => {
    const data: CreateApiKeyData = {
      name: name.trim(),
      type,
      permission_scope: permissionScope,
      allowed_projects: selectedProjects,
    };

    // Add optional fields only if they have values
    if (permissionScope === 'custom') {
      data.permissions = permissions;
    }
    if (allowedOrigins.length > 0) {
      data.allowed_origins = allowedOrigins;
    }
    if (rateLimitPerMinute !== undefined && rateLimitPerMinute >= 0) {
      data.rate_limit_per_minute = rateLimitPerMinute;
    }
    if (rateLimitPerHour !== undefined && rateLimitPerHour >= 0) {
      data.rate_limit_per_hour = rateLimitPerHour;
    }
    if (rateLimitPerDay !== undefined && rateLimitPerDay >= 0) {
      data.rate_limit_per_day = rateLimitPerDay;
    }
    if (expiresAt) {
      data.expires_at = expiresAt.toISOString();
    }

    return data;
  }, [
    name,
    type,
    permissionScope,
    selectedProjects,
    permissions,
    allowedOrigins,
    rateLimitPerMinute,
    rateLimitPerHour,
    rateLimitPerDay,
    expiresAt,
  ]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();

      if (!validateForm()) {
        return;
      }

      const data = buildFormData();
      await onSubmit(data);
      onOpenChange(false);
    },
    [validateForm, buildFormData, onSubmit, onOpenChange]
  );

  // Show the creation form
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="dialog" aria-modal="true" aria-labelledby="create-api-key-dialog-title">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle id="create-api-key-dialog-title">
              {t('apiKeys.createDialog.title')}
            </DialogTitle>
            <DialogDescription>{t('apiKeys.createDialog.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name Input */}
            <div className="space-y-2">
              <Label htmlFor="api-key-name">{t('apiKeys.createDialog.nameLabel')}</Label>
              <Input
                id="api-key-name"
                placeholder={t('apiKeys.createDialog.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* Type Selection */}
            <div className="space-y-2">
              <Label htmlFor="api-key-type">{t('apiKeys.createDialog.typeLabel')}</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as ApiKeyType)}
                disabled={isLoading}
              >
                <SelectTrigger id="api-key-type">
                  <SelectValue placeholder={t('apiKeys.createDialog.typeSelectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="development">
                    {t('apiKeys.createDialog.typeDevelopment')}
                  </SelectItem>
                  <SelectItem value="test">{t('apiKeys.createDialog.typeTest')}</SelectItem>
                  <SelectItem value="production">
                    {t('apiKeys.createDialog.typeProduction')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Permission Scope */}
            <div className="space-y-2">
              <Label htmlFor="permission-scope">
                {t('apiKeys.createDialog.permissionScopeLabel')}
              </Label>
              <Select
                value={permissionScope}
                onValueChange={(value) => setPermissionScope(value as PermissionScope)}
                disabled={isLoading}
              >
                <SelectTrigger id="permission-scope">
                  <SelectValue placeholder={t('apiKeys.createDialog.permissionScopePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">
                    {t('apiKeys.createDialog.permissionScopeFull')}
                  </SelectItem>
                  <SelectItem value="read">
                    {t('apiKeys.createDialog.permissionScopeRead')}
                  </SelectItem>
                  <SelectItem value="write">
                    {t('apiKeys.createDialog.permissionScopeWrite')}
                  </SelectItem>
                  <SelectItem value="custom">
                    {t('apiKeys.createDialog.permissionScopeCustom')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Project Selection (Multi-select) */}
            <div className="space-y-2">
              <Label>{t('apiKeys.createDialog.allowedProjectsLabel')}</Label>
              <div className="space-y-2 border rounded-lg p-4 max-h-48 overflow-y-auto">
                {projects.map((project) => (
                  <div key={project.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`project-${project.id}`}
                      checked={selectedProjects.includes(project.id)}
                      onCheckedChange={() => handleProjectToggle(project.id)}
                      disabled={isLoading}
                    />
                    <label
                      htmlFor={`project-${project.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {project.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Permissions (only show when permission_scope is 'custom') */}
            {permissionScope === 'custom' && (
              <div className="space-y-2">
                <Label>{t('apiKeys.createDialog.customPermissionsLabel')}</Label>
                <div className="space-y-2 border rounded-lg p-4">
                  {PERMISSION_OPTIONS.map((permission) => (
                    <div key={permission.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`permission-${permission.id}`}
                        checked={permissions.includes(permission.id)}
                        onCheckedChange={() => handlePermissionToggle(permission.id)}
                        disabled={isLoading}
                      />
                      <label
                        htmlFor={`permission-${permission.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {t(permission.labelKey)}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              {t('apiKeys.createDialog.cancel')}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t('apiKeys.createDialog.creating') : t('apiKeys.createDialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
