-- Rollback of 20261018000000_admin_review_reminders.sql.
-- Stops both reminders and drops their functions. Reminders already in the
-- bell stay until read; delete them with
--   DELETE FROM notifications WHERE type = 'admin_review';

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['admin-review-daily', 'admin-review-weekly-email'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS notify_admins_review_queue();
DROP FUNCTION IF EXISTS admin_review_summary();
