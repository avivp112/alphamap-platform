-- =============================================================================
-- 20261106000000_refresh_fields.sql
--
-- startups.refresh_fields: fields to collect again on the next enrichment,
-- even though they hold a value. First use (owner, 2026-10-25): a description
-- or value proposition that the text rule (lib/enrichment/narrative.ts) would
-- leave empty is NOT emptied — it is listed here, the site already hides the
-- offending clauses, and the next v2 run (bulk or "Deepen this profile")
-- writes a fresh, clean text over it and removes the field from the list.
-- The bulk run takes these companies first.
--
-- Additive. RUN BEFORE deploying the worker or running the bulk enrichment:
-- both read the column.
-- Rollback: supabase/rollback/20261106000000_refresh_fields_down.sql
-- =============================================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS refresh_fields text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN startups.refresh_fields IS
  'Fields enrichment v2 collects again and may overwrite (e.g. {description}). Emptied by the run that rewrites them.';

CREATE INDEX IF NOT EXISTS idx_startups_refresh_fields ON startups (id) WHERE cardinality(refresh_fields) > 0;

-- Confirm.
SELECT column_name, data_type, column_default FROM information_schema.columns
 WHERE table_name = 'startups' AND column_name = 'refresh_fields';
