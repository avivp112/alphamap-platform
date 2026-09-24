-- Rollback for 20260929000000_user_webhooks_unique_per_user.sql

ALTER TABLE user_webhooks DROP CONSTRAINT IF EXISTS uq_user_webhooks_user_id;
