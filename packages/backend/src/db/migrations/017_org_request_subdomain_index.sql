-- Migration 017: index for organization_requests.subdomain lookups
--
-- SubdomainService.isAvailable() calls
-- OrganizationRequestRepository.isSubdomainReservedByRequest() on every
-- self-service signup (and up to 50 times per collision-resolution loop
-- inside generateUniqueFromName). Without an index, those queries
-- degrade to a seq scan as the table grows.
--
-- A partial functional index on non-terminal statuses keeps the index
-- small (terminal rows — rejected/expired — dominate over time and are
-- not queried here).

SET search_path TO saas;

CREATE INDEX IF NOT EXISTS idx_org_requests_subdomain_active
  ON organization_requests (subdomain)
  WHERE status IN ('pending_verification', 'verified', 'approved');

SET search_path TO application, saas, public;
