import { useState, useEffect } from 'react';
import { invitationService } from '../services/api';
import type { InvitationPreview } from '../services/invitation-service';

/**
 * Fetches invitation preview when an invite_token is present.
 * Returns the preview object (or null if unavailable/failed).
 */
export function useInvitationPreview(inviteToken: string | null) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);

  useEffect(() => {
    if (!inviteToken) {
      return;
    }
    invitationService.preview(inviteToken).then(
      (data) => setPreview(data),
      (error) => {
        // Non-critical — generic banner shown as fallback
        if (import.meta.env.DEV) {
          console.warn('Failed to fetch invitation preview:', error);
        }
      }
    );
  }, [inviteToken]);

  return preview;
}
