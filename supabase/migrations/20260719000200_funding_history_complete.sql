-- =============================================================================
-- Migration: funding_history_complete
-- Created:   2026-07-19
-- Description: Companies with a Series B+ round often have earlier Seed/Series A
--              rounds that general web search doesn't surface (search engines
--              rank recent news over years-old funding announcements). Rather
--              than have the pipeline silently present a partial round history
--              as if it were complete, scripts/bulk_enrich_all.ts now asks
--              Claude to explicitly flag when it suspects the funding history
--              it found is incomplete (e.g. a later round with no earlier one,
--              or a source citing more total rounds than could be itemized).
--
--              NULL means "not yet assessed by any enrichment run" (distinct
--              from true/false, both of which are an actual verdict from the
--              last run). Unlike most profile fields, this is NOT fill-null
--              only — it's always overwritten with the latest run's
--              assessment, since a later pass finding the missing early round
--              should be able to flip false -> true (and the reverse should
--              also be possible if new evidence of a gap surfaces later).
-- =============================================================================

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS funding_history_complete boolean;

COMMENT ON COLUMN startups.funding_history_complete IS
  'Claude''s assessment, as of the last enrichment run, of whether funding_rounds represents this company''s complete history. NULL = not yet assessed. FALSE = a gap is suspected (e.g. a later round found with no earlier Seed/Series A, or a source cites more total rounds than could be itemized) — surface this in the UI rather than presenting the history as complete. Always overwritten by the latest run, not fill-null-only.';
