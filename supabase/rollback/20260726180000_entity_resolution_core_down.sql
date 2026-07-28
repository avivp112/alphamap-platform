-- =============================================================================
-- DOWN migration for 20260726180000_entity_resolution_core.sql
--
-- RUN 20260726190000_company_merge_down.sql FIRST — merge_companies() and
-- unmerge_company() both read company_merges, and dropping the table while they
-- exist leaves functions that fail at call time rather than at drop time.
--
-- THIS DESTROYS THE AUDIT TRAIL. company_merges holds the only snapshot of
-- every company that was merged away; once dropped, those merges become
-- permanently irreversible. Everything else here is rebuildable from existing
-- data, but that table is not.
--
--   CREATE TABLE company_merges_backup AS SELECT * FROM company_merges;
--
-- company_identifiers is cheap to rebuild — the backfill in the up migration
-- reads only from tables that still exist. entity_match_candidates loses any
-- pending human decisions, which is annoying rather than fatal.
--
-- pg_trgm is deliberately NOT dropped: other things may come to depend on it,
-- and an unused extension costs nothing.
-- =============================================================================

DROP TABLE IF EXISTS company_merges;
DROP TABLE IF EXISTS entity_match_candidates;
DROP TABLE IF EXISTS company_identifiers;

DROP INDEX IF EXISTS idx_startups_name_norm_trgm;
DROP INDEX IF EXISTS idx_startups_domain;

DROP FUNCTION IF EXISTS registrable_domain(text);
DROP FUNCTION IF EXISTS normalize_company_name(text);
