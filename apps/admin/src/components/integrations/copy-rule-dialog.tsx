/**
 * Copy Rule Dialog Component
 */

import { useTranslation } from 'react-i18next';
import type { IntegrationRule } from '../../types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Select } from '../ui/select';

export interface CopyRuleDialogProps {
  open: boolean;
  rule: IntegrationRule | null;
  targetProjects: Array<{ id: string; name: string }>;
  targetProjectId: string;
  onTargetProjectChange: (projectId: string) => void;
  onCopy: () => void;
  onClose: () => void;
  isSubmitting: boolean;
}

export function CopyRuleDialog({
  open,
  rule,
  targetProjects,
  targetProjectId,
  onTargetProjectChange,
  onCopy,
  onClose,
  isSubmitting,
}: CopyRuleDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('integrations.copyRule.title')}</DialogTitle>
          <DialogDescription>
            {t('integrations.copyRule.description', { name: rule?.name || '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label htmlFor="target-project" className="text-sm font-medium">
              {t('integrations.copyRule.targetProject')}
            </label>
            <Select
              id="target-project"
              value={targetProjectId}
              onChange={(e) => onTargetProjectChange(e.target.value)}
            >
              <option value="">{t('integrations.copyRule.selectProject')}</option>
              {targetProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          {targetProjectId && (
            <div className="rounded-md bg-blue-50 p-3">
              <p className="text-sm text-blue-900">
                <strong>{t('integrations.copyRule.noteTitle')}</strong>{' '}
                {t('integrations.copyRule.noteDescription')}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('integrations.copyRule.cancel')}
          </Button>
          <Button onClick={onCopy} disabled={!targetProjectId || isSubmitting}>
            {isSubmitting
              ? t('integrations.copyRule.copying')
              : t('integrations.copyRule.copyButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
