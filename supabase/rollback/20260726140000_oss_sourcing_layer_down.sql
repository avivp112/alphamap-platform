-- =============================================================================
-- DOWN migration for 20260726140000_oss_sourcing_layer.sql
--
-- THIS DESTROYS THE ONLY IRREPLACEABLE DATA IN THE PIPELINE.
--
-- Every other source can be re-fetched: SEC, Companies House and USPTO all
-- serve history. oss_project_metrics cannot. GitHub and Hugging Face expose
-- only the CURRENT counter, so a star count observed last Tuesday exists
-- nowhere else in the world once this table is gone — and velocity is the
-- entire reason this layer exists. Dropping it does not lose a week of work,
-- it loses however long the crawler has been running.
--
--   CREATE TABLE oss_project_metrics_backup AS SELECT * FROM oss_project_metrics;
--   CREATE TABLE oss_projects_backup        AS SELECT * FROM oss_projects;
--
-- Deliberately NOT in supabase/migrations/ — the CLI would run it as a forward
-- migration.
-- =============================================================================

DROP VIEW  IF EXISTS oss_project_velocity;
DROP FUNCTION IF EXISTS record_oss_observation(text,text,text,text,text,text,text,text,text[],text,timestamptz,jsonb,integer,integer,integer,integer,bigint);
-- metrics first: it has the FK.
DROP TABLE IF EXISTS oss_project_metrics;
DROP TABLE IF EXISTS oss_projects;
DROP TABLE IF EXISTS oss_excluded_owners;
