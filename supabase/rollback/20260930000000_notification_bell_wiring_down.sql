-- Rollback for 20260930000000_notification_bell_wiring.sql

DROP TRIGGER IF EXISTS trg_notify_welcome_on_mandate_created ON user_mandates;
DROP FUNCTION IF EXISTS notify_welcome_on_mandate_created();
