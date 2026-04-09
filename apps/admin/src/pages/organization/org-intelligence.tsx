/**
 * Organization Intelligence Settings Page
 * Configure AI-powered analysis, duplicate detection, and self-service resolution.
 */

import { useOrganization } from '../../contexts/organization-context';
import { IntelligenceSettingsPanel } from '../../components/intelligence/intelligence-settings-panel';

export default function OrgIntelligencePage() {
  const { currentOrganization: org } = useOrganization();

  if (!org) {
    return null;
  }

  return <IntelligenceSettingsPanel orgId={org.id} />;
}
