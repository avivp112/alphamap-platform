-- =============================================================================
-- "Check a company": a checked company enters AlphaMap only with an admin's
-- approval (decision of 2026-10-19).
--
-- A check that ends with a full profile (status done) is proposed here by the
-- worker, with the research as it was collected. The admin sees it in its own
-- tab of the review screen (/admin/review, "From user checks"); an approval
-- hands it back to the worker, which writes it by enrichment v2's own write
-- rules (lib/enrichment/writeCompany.ts — the same code as the bulk run).
-- Nothing reaches startups without that approval.
--
--   check_promotions          one row per proposed check. Admins read it;
--                             only the RPCs below change it.
--   approve / reject          admins.
--   claim / start / finish    the worker (service role).
--
-- What the admin may read of a user's check: only checks proposed here
-- (policy company_checks_select_admin_promoted) — not the rest of anyone's
-- checks.
--
-- Rollback: supabase/rollback/20261025000000_check_promotions_down.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS check_promotions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id     uuid        NOT NULL UNIQUE REFERENCES company_checks (id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending',    -- waiting for an admin
                             'approved',   -- waiting for the worker
                             'writing',    -- the worker is writing it
                             'written',    -- a new AlphaMap company
                             'linked',     -- was already in AlphaMap: linked, nothing written
                             'rejected',
                             'failed')),
  -- The research as collected (worker/promote.ts serializeCollected). Read by
  -- the worker only; the review screen shows the check's own profile.
  collected    jsonb       NOT NULL,
  startup_id   uuid        REFERENCES startups (id) ON DELETE SET NULL,
  reviewed_by  uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  review_note  text        CHECK (review_note IS NULL OR char_length(review_note) <= 2000),
  error        text,
  claimed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE check_promotions IS
  'Checked companies proposed for AlphaMap. Enter startups only through approve_check_promotion() + the worker.';

CREATE INDEX IF NOT EXISTS idx_check_promotions_status ON check_promotions (status, created_at);

ALTER TABLE check_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS check_promotions_select_admin ON check_promotions;
CREATE POLICY check_promotions_select_admin ON check_promotions FOR SELECT USING (is_app_admin());
REVOKE ALL ON check_promotions FROM anon;
GRANT SELECT ON check_promotions TO authenticated;

-- The admin reads the check behind a proposal (its profile, sources,
-- identity) and nothing else of the user's checks.
DROP POLICY IF EXISTS company_checks_select_admin_promoted ON company_checks;
CREATE POLICY company_checks_select_admin_promoted ON company_checks FOR SELECT
  USING (is_app_admin() AND EXISTS (SELECT 1 FROM check_promotions p WHERE p.check_id = company_checks.id));

-- ── Admin ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_check_promotion(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_app_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'approve_check_promotion: admins only' USING ERRCODE = '42501';
  END IF;
  -- A failed write that already created its company is not retried: a second
  -- write would add its rounds twice.
  UPDATE check_promotions
     SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = coalesce(p_note, review_note), error = NULL, updated_at = now()
   WHERE id = p_id
     AND (status = 'pending' OR (status = 'failed' AND startup_id IS NULL));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_check_promotion: % is not waiting for a decision', p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reject_check_promotion(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_app_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'reject_check_promotion: admins only' USING ERRCODE = '42501';
  END IF;
  UPDATE check_promotions
     SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = coalesce(p_note, review_note), updated_at = now()
   WHERE id = p_id AND status IN ('pending', 'approved', 'failed') AND startup_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_check_promotion: % can no longer be rejected', p_id;
  END IF;
END;
$$;

-- ── Worker ───────────────────────────────────────────────────────────────────
-- The next approved proposal, with what the worker needs to write it. A
-- claim that died before creating its company (no startup_id) is taken again
-- after 15 minutes; one that died after is left for a person to look at.
CREATE OR REPLACE FUNCTION claim_check_promotion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p check_promotions%ROWTYPE;
  c company_checks%ROWTYPE;
BEGIN
  SELECT * INTO p FROM check_promotions
   WHERE status = 'approved'
      OR (status = 'writing' AND startup_id IS NULL AND claimed_at < now() - interval '15 minutes')
   ORDER BY reviewed_at NULLS LAST, created_at
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE check_promotions SET status = 'writing', claimed_at = now(), updated_at = now() WHERE id = p.id;
  SELECT * INTO c FROM company_checks WHERE id = p.check_id;
  RETURN jsonb_build_object(
    'id', p.id, 'check_id', p.check_id, 'user_id', c.user_id,
    'name', coalesce(nullif(c.identity->>'name', ''), c.input->>'name'),
    'website', coalesce(nullif(c.identity->>'website', ''), c.input->>'website'),
    'collected', p.collected);
END;
$$;

-- Creates the company row, empty but for name and website (the research
-- fills the rest), and records it on the proposal in the same transaction.
CREATE OR REPLACE FUNCTION start_check_promotion_write(p_id uuid, p_name text, p_website text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_startup_id uuid;
  v_slug       text := gov_company_slug(btrim(p_name));
BEGIN
  PERFORM 1 FROM check_promotions WHERE id = p_id AND status = 'writing' AND startup_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'start_check_promotion_write: % is not being written', p_id;
  END IF;
  INSERT INTO startups (name, slug, website)
  VALUES (btrim(p_name),
          CASE WHEN v_slug IS NOT NULL AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.slug = v_slug) THEN v_slug END,
          nullif(btrim(p_website), ''))
  RETURNING id INTO v_startup_id;
  UPDATE check_promotions SET startup_id = v_startup_id, updated_at = now() WHERE id = p_id;
  RETURN v_startup_id;
END;
$$;

-- written / linked: the user's check and CRM row point at the company from
-- now on (the CRM row puts it on their watchlist — trg_crm_watch_company).
CREATE OR REPLACE FUNCTION finish_check_promotion(p_id uuid, p_status text, p_startup_id uuid DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p check_promotions%ROWTYPE;
BEGIN
  IF p_status NOT IN ('written', 'linked', 'failed') THEN
    RAISE EXCEPTION 'finish_check_promotion: bad status %', p_status;
  END IF;
  UPDATE check_promotions
     SET status = p_status, startup_id = coalesce(p_startup_id, startup_id), error = p_error, updated_at = now()
   WHERE id = p_id AND status = 'writing'
  RETURNING * INTO p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finish_check_promotion: % is not being written', p_id;
  END IF;
  IF p_status IN ('written', 'linked') AND p.startup_id IS NOT NULL THEN
    UPDATE company_checks SET matched_startup_id = p.startup_id WHERE id = p.check_id;
    UPDATE crm_companies cc SET startup_id = p.startup_id, updated_at = now()
     WHERE cc.check_id = p.check_id AND cc.startup_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM crm_companies o WHERE o.user_id = cc.user_id AND o.startup_id = p.startup_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION approve_check_promotion(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reject_check_promotion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_check_promotion(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reject_check_promotion(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION claim_check_promotion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION start_check_promotion_write(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finish_check_promotion(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_check_promotion() TO service_role;
GRANT EXECUTE ON FUNCTION start_check_promotion_write(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION finish_check_promotion(uuid, text, uuid, text) TO service_role;
