-- =============================================================================
-- DOWN migration for 20260726160000_patent_excluded_applicants.sql
--
-- Removes the private-market boundary from the patent layer. After this,
-- ingest-epo-ops's denylist lookup fails and the function returns a 500 —
-- deliberately, rather than silently ingesting IBM and Samsung again. Redeploy
-- the pre-boundary function if you really want that.
--
-- Rows already excluded are NOT restored: they were never ingested, so there is
-- nothing to restore. Rows ingested BEFORE the boundary existed are untouched.
--
-- Deliberately NOT in supabase/migrations/ — the CLI would run it as a forward
-- migration.
-- =============================================================================

DROP VIEW     IF EXISTS patent_excluded_already_ingested;
DROP INDEX    IF EXISTS idx_raw_gov_filings_applicant_norm;
DROP FUNCTION IF EXISTS count_patent_publications(text[], date);
DROP FUNCTION IF EXISTS filter_excluded_applicants(text[]);
DROP FUNCTION IF EXISTS is_excluded_applicant(text);
DROP TABLE    IF EXISTS patent_excluded_applicants;
-- Last: the index and both helpers depend on it.
DROP FUNCTION IF EXISTS normalize_applicant_name(text);
