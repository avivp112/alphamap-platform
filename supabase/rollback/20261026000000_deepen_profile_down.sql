-- Rollback of 20261026000000_deepen_profile.sql. Re-apply 20261022000000's
-- finish_company_check and 20261025000000's claim/reject functions after it.
DROP FUNCTION IF EXISTS startup_completeness(uuid);
DROP INDEX IF EXISTS uq_company_checks_deepen_in_flight;
DELETE FROM check_promotions WHERE kind = 'update';
ALTER TABLE check_promotions DROP CONSTRAINT IF EXISTS check_promotions_kind_check;
ALTER TABLE check_promotions DROP COLUMN IF EXISTS diff;
ALTER TABLE check_promotions DROP COLUMN IF EXISTS kind;
UPDATE company_checks SET status = 'done' WHERE status = 'no_new_data';
ALTER TABLE company_checks DROP CONSTRAINT IF EXISTS company_checks_status_check;
ALTER TABLE company_checks ADD CONSTRAINT company_checks_status_check CHECK (status IN (
  'matched', 'queued', 'running', 'awaiting_confirmation', 'ready', 'stealth',
  'rejected_public', 'rejected_non_tech', 'done', 'failed', 'cancelled'));
ALTER TABLE company_checks DROP CONSTRAINT IF EXISTS company_checks_kind_check;
ALTER TABLE company_checks DROP COLUMN IF EXISTS free_of_charge;
ALTER TABLE company_checks DROP COLUMN IF EXISTS kind;
