-- Rollback for 20260925000000_preference_vector_recompute.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-preference-vectors') THEN
    PERFORM cron.unschedule('recompute-preference-vectors');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS recompute_user_preference_vectors();
