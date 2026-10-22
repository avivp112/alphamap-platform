-- =============================================================================
-- Job boards: the name alone never verifies a board (decision of 2026-10-22)
--
-- A board is found by guessing its slug from the company's name or domain, so
-- "the board's name is the company's name" only repeats the guess: any other
-- company called Vasco has an ashby/vasco board that names Vasco. Rules v2
-- (worker/boards.ts, LINK_RULES_VERSION = 2):
--
--   verified        website_link    the company's own site links to the board
--                   domain_match    the board declares the company's website
--                                   (Workable, Ashby, Lever), or its intro links to it (Greenhouse)
--                   posting_domain  the postings give the company's domain
--   low_confidence  name_match / content_match — only the name agrees.
--                   Kept, NEVER shown on a profile.
--   mismatch, unverifiable          as before
--
-- Every board checked under the first rules is checked again: the worker
-- claims boards with link_rule_version below its own first. The verdict it
-- replaces is kept in link_previous, and board_link_report() shows what the
-- recheck changed.
--
-- The old claim_board_links(integer) / record_board_link(uuid, ...) stay for a
-- worker not yet redeployed; what it writes carries rule version 1, so it is
-- checked again by the new one.
--
-- Rollback: supabase/rollback/20261028000000_board_link_rules_v2_down.sql
-- =============================================================================

ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS link_rule_version integer NOT NULL DEFAULT 1;
ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS link_previous jsonb;
COMMENT ON COLUMN sourcing_companies.link_rule_version IS
  'The version of the worker''s rules (worker/boards.ts LINK_RULES_VERSION) that set link_status; older ones are checked again.';
COMMENT ON COLUMN sourcing_companies.link_previous IS
  'The verdict under older rules, replaced by a recheck: {status, method, rule_version}.';
COMMENT ON COLUMN sourcing_companies.link_status IS
  'Is this board the linked company''s? Only verified is shown on a profile; low_confidence (the name alone agrees) never is. Set by the check worker (worker/boards.ts).';

ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_link_status_check;
ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_link_status_check
  CHECK (link_status IN ('unchecked', 'verified', 'low_confidence', 'mismatch', 'unverifiable'));
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_link_method_check;
ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_link_method_check
  CHECK (link_method IS NULL OR link_method IN ('website_link', 'domain_match', 'posting_domain', 'name_match', 'content_match'));

-- ── Worker (service role) ────────────────────────────────────────────────────
-- Never checked first, then checked under older rules, then not checked for
-- 30 days. A claim that never answered is handed out again after 15 minutes.
CREATE OR REPLACE FUNCTION claim_board_links(p_limit integer, p_rule_version integer)
RETURNS TABLE (id uuid, ats_provider text, ats_board_token text, startup_id uuid, startup_name text, website text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT sc.id FROM sourcing_companies sc
     WHERE sc.startup_id IS NOT NULL
       AND (sc.link_checked_at IS NULL
            OR ((sc.link_rule_version < p_rule_version OR sc.link_status = 'unchecked')
                AND sc.link_checked_at < now() - interval '15 minutes')
            OR sc.link_checked_at < now() - interval '30 days')
     ORDER BY sc.link_checked_at IS NULL DESC, sc.link_rule_version < p_rule_version DESC, sc.link_checked_at
     LIMIT greatest(1, least(p_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), stamped AS (
    UPDATE sourcing_companies sc SET link_checked_at = now()
      FROM picked WHERE sc.id = picked.id
    RETURNING sc.id, sc.ats_provider, sc.ats_board_token, sc.startup_id
  )
  SELECT st.id, st.ats_provider::text, st.ats_board_token::text, st.startup_id, s.name, s.website
    FROM stamped st JOIN startups s ON s.id = st.startup_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_board_link(p_id uuid, p_status text, p_method text, p_evidence jsonb, p_rule_version integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE sourcing_companies
     SET link_previous = CASE WHEN link_rule_version < p_rule_version AND link_status <> 'unchecked'
                              THEN jsonb_build_object('status', link_status, 'method', link_method, 'rule_version', link_rule_version)
                              ELSE link_previous END,
         link_status = p_status, link_method = p_method, link_evidence = p_evidence,
         link_rule_version = p_rule_version, link_checked_at = now()
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION claim_board_links(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_board_link(uuid, text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_board_links(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION record_board_link(uuid, text, text, jsonb, integer) TO service_role;

-- ── The report ───────────────────────────────────────────────────────────────
-- SELECT board_link_report();
--   by_status / by_status_and_method   all linked boards, as they stand
--   recheck                            progress of the recheck under the current rules,
--                                      what it changed (before -> after), 10 examples
--   mismatch_examples                  10 boards that are someone else's
CREATE OR REPLACE FUNCTION board_link_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules integer;
BEGIN
  -- No user at all = the SQL Editor (anon has no EXECUTE on this function).
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR is_app_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'board_link_report: admins only' USING ERRCODE = '42501';
  END IF;
  SELECT max(link_rule_version) INTO v_rules FROM sourcing_companies WHERE startup_id IS NOT NULL;
  RETURN jsonb_build_object(
    'boards_linked', (SELECT count(*) FROM sourcing_companies WHERE startup_id IS NOT NULL),
    'shown_on_profiles', (SELECT count(*) FROM sourcing_companies WHERE startup_id IS NOT NULL AND link_status = 'verified'),
    'by_status', (SELECT coalesce(jsonb_object_agg(link_status, n), '{}'::jsonb)
                    FROM (SELECT link_status, count(*) n FROM sourcing_companies WHERE startup_id IS NOT NULL GROUP BY 1) x),
    'by_status_and_method', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', link_status, 'method', coalesce(link_method, '—'), 'boards', n) ORDER BY link_status, n DESC), '[]'::jsonb)
                    FROM (SELECT link_status, link_method, count(*) n FROM sourcing_companies WHERE startup_id IS NOT NULL GROUP BY 1, 2) x),
    'found_on_company_websites', (SELECT count(*) FROM sourcing_companies WHERE found_via = 'company_website'),
    'recheck', jsonb_build_object(
      'rules_version', v_rules,
      'checked_under_current_rules', (SELECT count(*) FROM sourcing_companies WHERE startup_id IS NOT NULL AND link_rule_version = v_rules AND link_status <> 'unchecked'),
      'waiting', (SELECT count(*) FROM sourcing_companies WHERE startup_id IS NOT NULL AND (link_rule_version < v_rules OR link_status = 'unchecked')),
      'changes', (SELECT coalesce(jsonb_agg(jsonb_build_object('before', b, 'after', a, 'boards', n) ORDER BY n DESC), '[]'::jsonb) FROM (
          SELECT (link_previous->>'status') || coalesce(' / ' || (link_previous->>'method'), '') AS b,
                 link_status || coalesce(' / ' || link_method, '') AS a, count(*) n
            FROM sourcing_companies
           WHERE startup_id IS NOT NULL AND link_previous IS NOT NULL AND link_rule_version = v_rules
           GROUP BY 1, 2) x),
      'examples', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
          SELECT s.name AS company, s.website, sc.ats_provider || '/' || sc.ats_board_token AS board,
                 (sc.link_previous->>'status') || coalesce(' / ' || (sc.link_previous->>'method'), '') AS before,
                 sc.link_status || coalesce(' / ' || sc.link_method, '') AS after,
                 sc.link_evidence AS evidence
            FROM sourcing_companies sc JOIN startups s ON s.id = sc.startup_id
           WHERE sc.link_previous IS NOT NULL AND sc.link_rule_version = v_rules
           -- what changed first, then the newest
           ORDER BY (sc.link_previous->>'status' IS DISTINCT FROM sc.link_status
                     OR sc.link_previous->>'method' IS DISTINCT FROM sc.link_method) DESC,
                    sc.link_checked_at DESC
           LIMIT 10) x)),
    'mismatch_examples', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT sc.ats_provider AS provider, sc.ats_board_token AS slug, s.name AS company, s.website, sc.link_method AS method, sc.link_evidence AS evidence
          FROM sourcing_companies sc JOIN startups s ON s.id = sc.startup_id
         WHERE sc.link_status = 'mismatch' ORDER BY sc.link_checked_at DESC LIMIT 10) x)
  );
END;
$$;
REVOKE ALL ON FUNCTION board_link_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION board_link_report() TO authenticated, service_role;
