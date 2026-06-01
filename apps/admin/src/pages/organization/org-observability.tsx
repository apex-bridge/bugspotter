import { useOrganization } from '../../contexts/organization-context';
import { ObservabilityPanel } from '../../components/intelligence/observability-panel';

export default function OrgObservabilityPage() {
  const { currentOrganization: org } = useOrganization();

  if (!org) {
    return null;
  }

  return <ObservabilityPanel orgId={org.id} />;
}
