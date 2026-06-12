-- Migration 026: rationale + event_id on bug_enrichments
--
-- Persist the LLM's one-sentence severity/category rationale and the upstream
-- intelligence_event id alongside the enrichment, so the admin "Why AI decided
-- this" accordion and observability cross-links work without re-running the LLM.
--
-- Both nullable: rows enriched before this migration, and enrichments from a
-- pre-rationale upstream, won't have them. No FK on event_id — the
-- intelligence_event lives in the separate intelligence service DB.

SET search_path TO application;

ALTER TABLE bug_enrichments
    ADD COLUMN IF NOT EXISTS rationale TEXT,
    ADD COLUMN IF NOT EXISTS event_id UUID;

COMMENT ON COLUMN bug_enrichments.rationale IS 'LLM one-sentence justification for the chosen severity/category (nullable; pre-migration rows are NULL)';
COMMENT ON COLUMN bug_enrichments.event_id IS 'Upstream intelligence_event id for this enrichment LLM call (no FK; lives in the intelligence DB)';
