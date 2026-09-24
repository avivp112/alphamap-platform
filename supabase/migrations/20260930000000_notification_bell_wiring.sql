-- =============================================================================
-- Migration: notification_bell_wiring
-- Created:   2026-09-30
-- Description:
--   Phase 10 of the preference engine: wires TopNav's bell (previously a
--   static decorative dot -- see the `notifications` table comment in
--   20260924000000_preference_engine_phase1.sql) to real data.
--
--   notifications is service-role-insert-only by design (see
--   notifications_service_insert), and nothing in this codebase writes a row
--   yet -- the general-purpose "alert-matching job" (watching new companies/
--   signals against each user's mandate) is a separate, later piece of
--   infrastructure. For now, a single concrete trigger: the moment a user
--   completes onboarding (their first user_mandates row is written), they
--   get a welcome notification, proving the bell end-to-end without waiting
--   on that larger job.
--
--   AFTER INSERT, not AFTER INSERT OR UPDATE: upsertUserMandate() in
--   src/lib/supabase.ts always calls .upsert() against user_mandates'
--   user_id primary key. Postgres only fires AFTER INSERT triggers for rows
--   that actually took the INSERT path of an INSERT ... ON CONFLICT DO
--   UPDATE -- a later mandate edit takes the DO UPDATE path instead, so this
--   fires exactly once per user, at first-time onboarding completion, never
--   again on a later edit.
--
--   SECURITY DEFINER (like calculate_alphamap_score / recompute_user_
--   preference_vectors elsewhere in this project): the trigger runs as its
--   owner, whose table-owner privileges bypass notifications' RLS the same
--   way those other functions bypass RLS on their own target tables -- the
--   inserting session is an ordinary `authenticated` user (onboarding runs
--   under the signed-in user's own session), who could never satisfy
--   notifications_service_insert on their own.
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_welcome_on_mandate_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, link)
  VALUES (
    NEW.user_id,
    'system',
    'Welcome to AlphaMap!',
    'Your investment mandate filters are now active — the Private Market page is personalized to your stages, sectors, and geographies.',
    '/startups'
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_welcome_on_mandate_created() IS
  'Phase 10: fires once per user, the moment their first user_mandates row is written (onboarding completion) -- inserts a welcome notification so TopNav''s bell has real data to show immediately. Never fires again on a later mandate edit (see migration header for why).';

DROP TRIGGER IF EXISTS trg_notify_welcome_on_mandate_created ON user_mandates;
CREATE TRIGGER trg_notify_welcome_on_mandate_created
  AFTER INSERT ON user_mandates
  FOR EACH ROW
  EXECUTE FUNCTION notify_welcome_on_mandate_created();
