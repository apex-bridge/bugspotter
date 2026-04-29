import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Brain } from 'lucide-react';
import { useOrganization } from '../../contexts/organization-context';

/**
 * Banner shown on the Details tab when the current org has
 * `intelligence_enabled = false`. Replaces the broken affordances
 * (enrichment card / similar bugs / suggest-fix) with a single
 * explanatory state. Org admins/owners get a link to settings; plain
 * members see the same text without the link.
 */
export function IntelligenceDisabledNotice() {
  const { t } = useTranslation();
  const { currentOrganization } = useOrganization();

  const role = currentOrganization?.my_role;
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="border rounded-lg p-4 bg-gray-50 border-gray-200">
      <div className="flex items-start gap-3">
        <Brain className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-gray-900">
            {t('intelligence.disabled.title')}
          </h4>
          <p className="text-sm text-gray-600 mt-1">
            {canManage
              ? t('intelligence.disabled.descriptionAdmin')
              : t('intelligence.disabled.descriptionMember')}
          </p>
          {canManage && (
            <Link
              to="/my-organization/intelligence"
              className="text-sm text-primary hover:underline mt-2 inline-block"
            >
              {t('intelligence.disabled.enableLink')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
