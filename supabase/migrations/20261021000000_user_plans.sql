-- =============================================================================
-- Migration: user_plans — a plan the user cannot grant themselves
-- Created:   2026-10-21
-- Description:
--   The subscription plan lived in auth user_metadata, which every signed-in
--   user can rewrite with supabase.auth.updateUser({ data: { plan } }) — and
--   the Checkout page did exactly that after a card form that charges
--   nothing. Anything keyed on the plan (the "check a company" monthly
--   allowance, from this feature on) could not be enforced.
--
--   user_plans: one row per user, readable by its owner, writable only by the
--   service role or an admin (set_user_plan). No row = free.
--   plan_requests: what Checkout now records instead of switching the plan;
--   each request rings the admins' bell.
--
--   Backfill: plans already in user_metadata ('pro' / 'enterprise') are
--   copied once, so nobody is downgraded by this migration. List them with
--   SELECT * FROM user_plans WHERE source = 'metadata_backfill';
--
-- Rollback: supabase/rollback/20261021000000_user_plans_down.sql
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_plans (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  plan       text        NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  source     text        NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'metadata_backfill', 'billing')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE user_plans IS
  'The plan that counts. Owner can read; only the service role or set_user_plan() (admins) can write. No row = free. auth user_metadata.plan is no longer read.';

ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_plans_select_own ON user_plans;
CREATE POLICY user_plans_select_own ON user_plans FOR SELECT USING (user_id = auth.uid());
REVOKE ALL ON user_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON user_plans TO authenticated;

INSERT INTO user_plans (user_id, plan, source)
SELECT u.id, u.raw_user_meta_data->>'plan', 'metadata_backfill'
  FROM auth.users u
 WHERE u.raw_user_meta_data->>'plan' IN ('pro', 'enterprise')
ON CONFLICT (user_id) DO NOTHING;

-- ── Requests from Checkout ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_requests (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plan       text        NOT NULL CHECK (plan IN ('pro', 'enterprise')),
  annual     boolean     NOT NULL DEFAULT false,
  status     text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'granted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_requests_select_own ON plan_requests;
CREATE POLICY plan_requests_select_own ON plan_requests FOR SELECT USING (user_id = auth.uid());
REVOKE ALL ON plan_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON plan_requests TO authenticated;

CREATE OR REPLACE FUNCTION request_plan_upgrade(p_plan text, p_annual boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501';
  END IF;
  IF p_plan NOT IN ('pro', 'enterprise') THEN
    RAISE EXCEPTION 'unknown plan: %', p_plan USING ERRCODE = '22023';
  END IF;
  -- One open request per user and plan is enough.
  SELECT id INTO v_id FROM plan_requests WHERE user_id = auth.uid() AND plan = p_plan AND status = 'open';
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO plan_requests (user_id, plan, annual) VALUES (auth.uid(), p_plan, coalesce(p_annual, false))
  RETURNING id INTO v_id;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
  SELECT a.user_id, 'plan_request',
         'Plan request: ' || p_plan,
         coalesce(v_email, 'A user') || ' asked for ' || p_plan || CASE WHEN p_annual THEN ' (annual)' ELSE '' END
           || '. Grant with SELECT set_user_plan(''' || auth.uid() || ''', ''' || p_plan || ''');',
         NULL, 'plan_request:' || v_id
    FROM app_admins a
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION request_plan_upgrade(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_plan_upgrade(text, boolean) TO authenticated;

-- ── Granting (admins; the service role writes the table directly) ───────────
CREATE OR REPLACE FUNCTION set_user_plan(p_user_id uuid, p_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_app_admin() THEN
    RAISE EXCEPTION 'admins only' USING ERRCODE = '42501';
  END IF;
  IF p_plan NOT IN ('free', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'unknown plan: %', p_plan USING ERRCODE = '22023';
  END IF;
  INSERT INTO user_plans (user_id, plan, source, updated_at, updated_by)
  VALUES (p_user_id, p_plan, 'admin', now(), auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET plan = EXCLUDED.plan, source = 'admin', updated_at = now(), updated_by = auth.uid();
  UPDATE plan_requests SET status = 'granted'
   WHERE user_id = p_user_id AND status = 'open' AND plan = p_plan;
END;
$$;

REVOKE ALL ON FUNCTION set_user_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_user_plan(uuid, text) TO authenticated, service_role;
