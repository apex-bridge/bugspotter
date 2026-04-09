import { useEffect, RefObject } from 'react';

/**
 * Custom hook for managing modal focus, body scroll lock, and keyboard events
 * Implements WCAG 2.1 AA accessibility standards for modal dialogs
 *
 * @param modalRef - Ref to the modal element that should receive focus
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Callback to close the modal (triggered by ESC key)
 */
export function useModalFocus(
  modalRef: RefObject<HTMLElement>,
  isOpen: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Store the element that had focus before modal opened
    const previousFocusElement = document.activeElement as HTMLElement;

    // Focus the modal
    modalRef.current?.focus();

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // ESC key handler
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);

    // Cleanup function
    return () => {
      // Restore body scroll
      document.body.style.overflow = '';

      // Remove ESC listener
      document.removeEventListener('keydown', handleEscape);

      // Restore focus to previous element
      previousFocusElement?.focus();
    };
  }, [isOpen, modalRef, onClose]);
}
