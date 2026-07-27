-- =============================================================================
-- DOWN migration for 20260726150000_epo_ops_source.sql
--
-- Narrows the source CHECK back to three values. Rows with source='epo_ops'
-- must go first — the constraint cannot be added while they exist — so THIS
-- DELETES DATA. EPO OPS records are re-fetchable, but only within the free
-- tier's throughput and only for date ranges you can reconstruct.
--
--   CREATE TABLE raw_gov_filings_epo_backup AS
--     SELECT * FROM raw_gov_filings WHERE source = 'epo_ops';
--
-- startups rows created from EPO applicants are left alone: they are real
-- companies regardless of which registry surfaced them.
-- =============================================================================

DELETE FROM raw_gov_filings WHERE source = 'epo_ops';

ALTER TABLE raw_gov_filings DROP CONSTRAINT IF EXISTS raw_gov_filings_source_check;
ALTER TABLE raw_gov_filings
  ADD CONSTRAINT raw_gov_filings_source_check
  CHECK (source IN ('sec_form_d', 'uk_companies_house', 'uspto_patent'));
