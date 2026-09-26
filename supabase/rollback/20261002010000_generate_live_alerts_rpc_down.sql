-- Rollback for 20261002010000_generate_live_alerts_rpc.sql
-- Unschedules the cron job and drops the function. Does not delete any
-- notifications rows it already wrote -- those are real alerts a user may
-- have already seen; removing the generator shouldn't retroactively erase
-- their notification history.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-live-alerts') THEN
    PERFORM cron.unschedule('generate-live-alerts');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS generate_live_alerts(integer, integer, integer);
