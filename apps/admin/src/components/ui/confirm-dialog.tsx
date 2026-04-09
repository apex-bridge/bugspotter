import { useRef } from 'react';
import { Button } from './button';
import { AlertTriangle } from 'lucide-react';
import { useModalFocus } from '../../hooks/use-modal-focus';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus management, body scroll lock, and ESC key handler
  useModalFocus(dialogRef, isOpen && !isLoading, onClose);

  if (!isOpen) {
    return null;
  }

  const variantStyles = {
    danger: 'text-red-600',
    warning: 'text-yellow-600',
    info: 'text-blue-600',
  };

  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4"
      >
        {/* Icon & Title */}
        <div className="flex items-start gap-4">
          <div className={`p-2 rounded-full bg-gray-100 ${variantStyles[variant]}`}>
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 id="dialog-title" className="text-xl font-semibold">
              {title}
            </h2>
            <p id="dialog-description" className="text-gray-600 mt-2">
              {message}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-4">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : 'primary'}
            onClick={handleConfirm}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
