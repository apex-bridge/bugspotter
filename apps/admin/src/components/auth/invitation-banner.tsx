import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { InvitationPreview } from '../../services/invitation-service';

interface InvitationBannerProps {
  preview: InvitationPreview | null;
  /** i18n key used when org name is available (receives `{ org }` interpolation) */
  i18nKeyWithOrg: string;
  /** i18n key used as fallback when preview hasn't loaded yet */
  i18nKeyFallback: string;
}

export function InvitationBanner({
  preview,
  i18nKeyWithOrg,
  i18nKeyFallback,
}: InvitationBannerProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 mb-4 text-sm text-blue-800">
      <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {preview ? t(i18nKeyWithOrg, { org: preview.organization_name }) : t(i18nKeyFallback)}
      </span>
    </div>
  );
}
