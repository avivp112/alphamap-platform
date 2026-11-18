-- Rollback of 20261204000000_candidate_evidence_merge.sql.
-- Evidence keys already merged stay on their candidates; the card ignores keys it does not know.
DROP FUNCTION IF EXISTS merge_candidate_evidence(uuid, jsonb);
