-- Rollback of 20261106000000_refresh_fields.sql. Deploy code that does not
-- read the column first (the worker and the bulk run select it).
DROP INDEX IF EXISTS idx_startups_refresh_fields;
ALTER TABLE startups DROP COLUMN IF EXISTS refresh_fields;
