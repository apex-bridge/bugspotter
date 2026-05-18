import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';

interface DedupRuleDeleteDialogProps {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
  isDeleting: boolean;
}

export function DedupRuleDeleteDialog({
  open,
  onConfirm,
  onClose,
  isDeleting,
}: DedupRuleDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dedupRules.deleteDialog.title')}</DialogTitle>
          <DialogDescription>{t('dedupRules.deleteDialog.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {t('dedupRules.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
