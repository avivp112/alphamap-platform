-- Rollback of 20261125000000_oss_candidates.sql. The corporate owners stay in oss_excluded_owners (removing them would re-admit
-- Tencent and Amazon projects); candidates already proposed stay in company_candidates (their review history).
DROP FUNCTION IF EXISTS propose_oss_candidates(integer, boolean);
DROP VIEW IF EXISTS oss_watchlist;
DROP VIEW IF EXISTS oss_candidate_pool;
DROP FUNCTION IF EXISTS oss_is_own_domain(text);
DROP FUNCTION IF EXISTS oss_candidate_params();
