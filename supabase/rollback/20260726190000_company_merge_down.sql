-- =============================================================================
-- DOWN migration for 20260726190000_company_merge.sql
--
-- Drops the merge machinery. RUN THIS BEFORE the 20260726180000 rollback —
-- these functions read company_merges.
--
-- MERGES ALREADY PERFORMED ARE NOT UNDONE. A merge deleted a row and repointed
-- foreign keys; removing the function that did it changes nothing about the
-- data. If you need a specific merge reversed, call unmerge_company() BEFORE
-- running this — afterwards the function is gone and the snapshot in
-- company_merges is the only remaining trace.
-- =============================================================================

DROP FUNCTION IF EXISTS unmerge_company(uuid, text);
DROP FUNCTION IF EXISTS merge_companies(uuid, uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS company_richness(uuid);
