-- =============================================================================
-- Migration: reminders for the company review queue
-- Created:   2026-10-18
-- Description:
--   Stage 5 of the opportunity-engine redesign. Candidates wait in
--   company_candidates until an admin approves or rejects them (/admin/review,
--   20261016000000); nothing tells the admin they are piling up except the
--   badge in the account menu. Two reminders, both silent when the queue is
--   empty:
--
--   1. DAILY, in the bell — notify_admins_review_queue(), pg_cron 06:00 UTC
--      (after the night's ingesters, 00:10-02:00, and the 05:30 health check).
--      One notification per admin. The previous day's reminder is removed if
--      still unread, so the bell holds the current count, never a stack of
--      stale ones; an empty queue removes it too.
--
--   2. WEEKLY, by email — the admin-review-digest Edge Function, Sundays
--      06:10 UTC, through Resend (RESEND_API_KEY, already set for
--      pipeline-health). Its numbers come from admin_review_summary() below.
--
--   Recipients: every account in app_admins.
--
-- Rollback: supabase/rollback/20261018000000_admin_review_reminders_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. The numbers both reminders use ────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_review_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH p AS (SELECT * FROM company_candidates WHERE status = 'pending')
  SELECT jsonb_build_object(
    'pending',           (SELECT count(*) FROM p),
    'pending_alert',     (SELECT count(*) FROM p WHERE gate_tier = 'alert'),
    'pending_queue',     (SELECT count(*) FROM p WHERE gate_tier = 'queue'),
    'by_source',         COALESCE((SELECT jsonb_object_agg(source, n) FROM (SELECT source, count(*) n FROM p GROUP BY source) s), '{}'::jsonb),
    'new_24h',           (SELECT count(*) FROM p WHERE first_seen_at >= now() - interval '24 hours'),
    'new_7d',            (SELECT count(*) FROM company_candidates WHERE first_seen_at >= now() - interval '7 days'),
    'approved_7d',       (SELECT count(*) FROM company_candidates WHERE status = 'approved' AND reviewed_at >= now() - interval '7 days'),
    'rejected_7d',       (SELECT count(*) FROM company_candidates WHERE status = 'rejected' AND reviewed_at >= now() - interval '7 days'),
    'oldest_pending_at', (SELECT min(first_seen_at) FROM p),
    -- Alert tier first: those already reached users' bells.
    'top',               COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'source', source, 'tier', gate_tier, 'first_seen_at', first_seen_at))
                                     FROM (SELECT name, source, gate_tier, first_seen_at FROM p
                                            ORDER BY gate_tier = 'alert' DESC, first_seen_at DESC LIMIT 10) t), '[]'::jsonb),
    'admin_emails',      COALESCE((SELECT jsonb_agg(u.email ORDER BY u.email)
                                     FROM app_admins a JOIN auth.users u ON u.id = a.user_id
                                    WHERE u.email IS NOT NULL), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION admin_review_summary() IS
  'Review-queue numbers for the admin reminders: pending (by tier and source), new in 24h / 7 days, decided in 7 days, oldest pending, the 10 to look at first (alert tier, newest), and the admins'' email addresses.';

REVOKE ALL ON FUNCTION admin_review_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_review_summary() TO service_role;

-- ── 2. Daily bell reminder ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_admins_review_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s       jsonb := admin_review_summary();
  v_n     integer := (s->>'pending')::integer;
  v_days  integer;
  v_parts text[] := '{}';
  v_body  text;
  n       integer;
BEGIN
  -- Yesterday's reminder, if unread, is replaced rather than stacked.
  DELETE FROM notifications
   WHERE type = 'admin_review' AND read_at IS NULL
     AND user_id IN (SELECT user_id FROM app_admins);

  IF v_n = 0 THEN
    RETURN 0;
  END IF;

  IF (s->>'pending_alert')::integer > 0 THEN
    v_parts := v_parts || ((s->>'pending_alert') || ' already alerted users');
  END IF;
  IF (s->>'pending_queue')::integer > 0 THEN
    v_parts := v_parts || ((s->>'pending_queue') || ' review-only');
  END IF;
  IF (s->>'new_24h')::integer > 0 THEN
    v_parts := v_parts || ((s->>'new_24h') || ' new since yesterday');
  END IF;
  v_days := floor(extract(epoch FROM now() - (s->>'oldest_pending_at')::timestamptz) / 86400);
  IF v_days >= 1 THEN
    v_parts := v_parts || ('oldest waiting ' || v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END);
  END IF;
  v_body := array_to_string(v_parts, ' · ') || '.';

  INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
  SELECT a.user_id,
         'admin_review',
         v_n || CASE WHEN v_n = 1 THEN ' company is' ELSE ' companies are' END || ' waiting for your review',
         v_body,
         '/admin/review',
         'admin_review:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    FROM app_admins a
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION notify_admins_review_queue() IS
  'Daily: one bell notification per admin with the review-queue count (replacing yesterday''s if unread); none — and yesterday''s removed — when nothing is pending.';

REVOKE ALL ON FUNCTION notify_admins_review_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_admins_review_queue() TO service_role;

-- ── 3. Schedules ─────────────────────────────────────────────────────────────
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

SELECT cron.schedule('admin-review-daily', '0 6 * * *', $cron$SELECT notify_admins_review_queue();$cron$);

SELECT cron.schedule(
  'admin-review-weekly-email', '10 6 * * 0',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/admin-review-digest',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
