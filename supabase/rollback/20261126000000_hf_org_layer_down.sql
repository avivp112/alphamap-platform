DROP FUNCTION IF EXISTS hf_orgs_to_snapshot(integer, interval);
-- Rollback of 20261126000000_hf_org_layer.sql. hf_org identifiers and candidates already recorded stay (review history).
DROP FUNCTION IF EXISTS propose_hf_candidates(integer, boolean);
DROP VIEW IF EXISTS hf_candidate_pool;
DROP FUNCTION IF EXISTS hf_candidate_params();
DROP FUNCTION IF EXISTS company_hf_summary(uuid);
DROP FUNCTION IF EXISTS link_hf_orgs(boolean);
DROP VIEW IF EXISTS hf_link_candidates;
DROP VIEW IF EXISTS hf_org_stats;
DROP FUNCTION IF EXISTS record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean);
DROP TABLE IF EXISTS hf_orgs;
