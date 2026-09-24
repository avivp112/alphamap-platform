-- Rollback for 20260924000000_preference_engine_phase1.sql
-- Drops all five new tables. No data migration needed — nothing else in the
-- schema reads from or depends on these yet (Phase 1 is schema-only).

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS user_webhooks;
DROP TABLE IF EXISTS user_preference_vectors;
DROP TABLE IF EXISTS user_interactions;
DROP TABLE IF EXISTS user_mandates;
