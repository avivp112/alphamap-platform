-- Rollback of 20261025000000_check_promotions.sql. Companies already written
-- stay in startups (they are ordinary AlphaMap companies by then).
DROP FUNCTION IF EXISTS finish_check_promotion(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS start_check_promotion_write(uuid, text, text);
DROP FUNCTION IF EXISTS claim_check_promotion();
DROP FUNCTION IF EXISTS reject_check_promotion(uuid, text);
DROP FUNCTION IF EXISTS approve_check_promotion(uuid, text);
DROP POLICY IF EXISTS company_checks_select_admin_promoted ON company_checks;
DROP TABLE IF EXISTS check_promotions;
