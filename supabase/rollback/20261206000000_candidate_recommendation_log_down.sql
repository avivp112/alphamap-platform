-- Rollback of 20261206000000_candidate_recommendation_log.sql.
DROP FUNCTION IF EXISTS record_candidate_recommendation(uuid, text, text[]);
ALTER TABLE company_candidates
  DROP COLUMN IF EXISTS recommendation, DROP COLUMN IF EXISTS recommendation_rules, DROP COLUMN IF EXISTS recommended_at;
