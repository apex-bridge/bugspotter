import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Copy, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiKeyResponse } from '../../types';

const AUTO_CLEAR_TIMEOUT = 30000; // 30 seconds
const COPY_FEEDBACK_TIMEOUT = 2000; // 2 seconds

interface ShowApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKey: ApiKeyResponse | null;
  title?: string;
  description?: string;
}

export function ShowApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  title = '',
  description = '',
}: ShowApiKeyDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const dialogTitle = title || t('apiKeys.showDialog.title');
  const dialogDescription = description || t('apiKeys.showDialog.description');

  // Clear copied state when dialog closes
  useEffect(() => {
    if (!open) {
      setCopied(false);
    }
  }, [open]);

  // Auto-clear after 30 seconds for security
  useEffect(() => {
    if (open && apiKey) {
      const timer = setTimeout(() => {
        onOpenChange(false);
        toast.info(t('apiKeys.showDialog.apiKeyCleared'));
      }, AUTO_CLEAR_TIMEOUT);
      return () => clearTimeout(timer);
    }
  }, [open, apiKey, onOpenChange, t]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!apiKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(apiKey.api_key);
      setCopied(true);
      toast.success(t('apiKeys.showDialog.apiKeyCopied'));
      setTimeout(() => setCopied(false), COPY_FEEDBACK_TIMEOUT);
    } catch {
      toast.error(t('errors.failedToCopyToClipboard'));
    }
  }, [apiKey, t]);

  if (!apiKey) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="dialog" aria-modal="true" aria-labelledby="show-api-key-dialog-title">
        <DialogHeader>
          <DialogTitle id="show-api-key-dialog-title">{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Security Warning */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle
              className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-sm text-yellow-800">
              <p className="font-semibold">{t('apiKeys.showDialog.securityWarningTitle')}</p>
              <p className="mt-1">{t('apiKeys.showDialog.securityWarningDescription')}</p>
            </div>
          </div>

          {/* API Key Display */}
          <div className="space-y-2">
            <Label htmlFor="api-key-display">{t('apiKeys.showDialog.apiKeyLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="api-key-display"
                value={apiKey.api_key}
                readOnly
                className="font-mono text-sm"
                onClick={(e) => {
                  if (e.target instanceof HTMLInputElement) {
                    e.target.select();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                aria-label={t('apiKeys.showDialog.copyToClipboard')}
              >
                {copied ? (
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
            </div>
          </div>

          {/* Key Details */}
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium">{t('apiKeys.showDialog.name')}</span> {apiKey.name}
            </div>
            <div>
              <span className="font-medium">{t('apiKeys.showDialog.keyPrefix')}</span>{' '}
              <code className="font-mono">{apiKey.key_prefix}...</code>
            </div>
            <div>
              <span className="font-medium">{t('apiKeys.showDialog.permissions')}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {apiKey.permissions.map((permission) => (
                  <span
                    key={permission}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {permission}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('apiKeys.showDialog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
