/**
 * Delete Organization Confirmation Dialog
 * Shows precheck info and offers soft or hard delete depending on vital data.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { organizationService } from '../../services/organization-service';
import { handleApiError } from '../../lib/api-client';

interface DeleteOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  onDelete: (permanent: boolean) => void;
  isDeleting: boolean;
}

export function DeleteOrganizationDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  onDelete,
  isDeleting,
}: DeleteOrganizationDialogProps) {
  const { t } = useTranslation();
  const [precheck, setPrecheck] = useState<{
    canHardDelete: boolean;
    hasProjects: boolean;
    projectCount: number;
    hasActiveSubscription: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    if (open) {
      setPermanent(false);
      setConfirmName('');
      setPrecheck(null);
      setError(null);
      setLoading(true);
      organizationService
        .adminDeletionPrecheck(orgId)
        .then(setPrecheck)
        .catch((err) => setError(handleApiError(err)))
        .finally(() => setLoading(false));
    }
  }, [open, orgId]);

  const canConfirmHardDelete = permanent && confirmName === orgName;
  const canConfirmSoftDelete = !permanent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('organizations.delete.title')}</DialogTitle>
          <DialogDescription>{orgName}</DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-gray-500 py-4">{t('common.loading')}</p>}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t('organizations.delete.precheckFailed', { error })}</span>
          </div>
        )}

        {precheck && (
          <div className="space-y-4">
            {/* Vital data info */}
            {precheck.hasProjects && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {t('organizations.delete.hasProjects', { count: precheck.projectCount })}
                </span>
              </div>
            )}
            {precheck.hasActiveSubscription && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{t('organizations.delete.hasActiveSubscription')}</span>
              </div>
            )}

            {/* Delete mode selection */}
            {precheck.canHardDelete ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">{t('organizations.delete.hardDescription')}</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="deleteMode"
                      checked={!permanent}
                      onChange={() => setPermanent(false)}
                      className="accent-primary"
                    />
                    <span className="text-sm">{t('organizations.delete.softButton')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="deleteMode"
                      checked={permanent}
                      onChange={() => setPermanent(true)}
                      className="accent-red-600"
                    />
                    <span className="text-sm text-red-600 font-medium">
                      {t('organizations.delete.hardButton')}
                    </span>
                  </label>
                </div>

                {/* Name confirmation for permanent delete */}
                {permanent && (
                  <div className="space-y-2">
                    <Label htmlFor="confirm-org-name" className="text-sm">
                      {t('organizations.delete.confirmName')}
                    </Label>
                    <Input
                      id="confirm-org-name"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={orgName}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">{t('organizations.delete.softDescription')}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
          {precheck && (
            <Button
              variant="destructive"
              onClick={() => onDelete(permanent)}
              disabled={isDeleting || (permanent ? !canConfirmHardDelete : !canConfirmSoftDelete)}
            >
              {isDeleting
                ? t('common.loading')
                : permanent
                  ? t('organizations.delete.hardButton')
                  : t('organizations.delete.softButton')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
