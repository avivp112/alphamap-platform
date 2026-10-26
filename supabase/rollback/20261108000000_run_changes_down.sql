DROP INDEX IF EXISTS idx_field_changes_run;
-- Rows with a NULL new_value must go before NOT NULL can return.
DELETE FROM field_changes WHERE new_value IS NULL;
ALTER TABLE field_changes ALTER COLUMN new_value SET NOT NULL;
