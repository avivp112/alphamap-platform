-- Rollback for 20261004000000_schedule_embedding_backfill.sql
-- Unschedules the cron job only. Does not touch any embedding already
-- written -- those are real, usable vectors, not something a scheduling
-- rollback should erase.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-embeddings') THEN
    PERFORM cron.unschedule('backfill-embeddings');
  END IF;
END;
$$;
