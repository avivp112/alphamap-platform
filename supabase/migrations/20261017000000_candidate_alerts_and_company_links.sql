-- =============================================================================
-- Migration: new-company alerts, the "filter my alerts" toggle, candidate
--            preview, and alert links that open the company itself
-- Created:   2026-10-17
-- Description:
--   Stage 4 of the opportunity-engine redesign (stages 1-3: company-gate.ts,
--   company_candidates, the /admin/review screen).
--
--   1. NEW-COMPANY ALERTS. A candidate the quality gate marked 'alert' (SEC
--      Form D; UK incorporations with 2+ directors and a product SIC code)
--      now reaches users' bells without waiting for admin approval — the
--      admin's approval decides only whether it enters the database. 'queue'
--      candidates (EPO patents) never alert. Rejecting a candidate already
--      deletes these notifications (reject_company_candidate, 20261016000000)
--      — the dedupe_key 'candidate:<id>' written here is the one it deletes.
--
--   2. THE TOGGLE (user_mandates.alerts_filtered, default OFF).
--      OFF: every alert-tier candidate, to every user.
--      ON:  only candidates that fit the user's questionnaire answers plus
--           the sectors of companies on their watchlist (learned taste):
--             - geographies: candidate country must be one of them;
--             - signal triggers: if the user picked "company registrations"
--               and/or "pre-public funding", the source must be one picked;
--             - stages: judged only when the filing says something about
--               stage (UK incorporation = pre-seed/seed; Form D by amount);
--             - sectors: the candidate's sector must be KNOWN and wanted.
--               A brand-new filing usually says almost nothing about sector
--               (most are "62012 software development" or "Other
--               Technology"), so a filtered user is NOT alerted about those:
--               missing is better than wrong. They still hear about them once
--               approved and enriched, through the existing thesis-match
--               alert, which compares against their watchlist's embedding.
--
--   3. LINKS. Every alert opens the company itself instead of a My Area tab:
--      watchlist / thesis-match alerts -> /startups?company=<id> (the app
--      opens that company's tearsheet); new-company alerts ->
--      /candidates/<id>, a read-only preview that forwards to the company
--      page once it is approved. Existing notifications are relinked.
--
--   4. get_candidate_preview(): what that preview page may show a signed-in
--      user — alert-tier candidates only (queue-tier ones are admin-only),
--      and nothing but a status for rejected ones.
--
--   generate_live_alerts keeps its 3-argument signature (the cron calls it
--   by position; a 4th parameter would add an ambiguous overload).
--
-- Rollback: supabase/rollback/20261017000000_candidate_alerts_and_company_links_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. The toggle ────────────────────────────────────────────────────────────
ALTER TABLE user_mandates
  ADD COLUMN IF NOT EXISTS alerts_filtered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_mandates.alerts_filtered IS
  'OFF (default): alert on every new company that passes the quality gate. ON: only those matching this mandate (stages, sectors, geographies, signal triggers) plus the sectors of the user''s watchlist; a new company whose sector cannot be told from its filing is skipped.';

-- ── 2. What a filing tells us about sector and stage ─────────────────────────
-- Strict on purpose. classify_sector_parent() is tuned for the descriptive
-- industry text of an enriched company; on a bare legal name its substring
-- rules misfire ("%erp%" in SUPERPOWER, "%media%" in INTERMEDIATE). Here: a
-- few structured signals, then whole words only. NULL = unknown.
CREATE OR REPLACE FUNCTION candidate_sector(p_source text, p_name text, p_evidence jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH x AS (
    SELECT coalesce(p_evidence, '{}'::jsonb) AS e,
           concat_ws(' ', p_name,
             CASE WHEN p_source = 'epo_ops' THEN p_evidence->>'title' END,
             CASE WHEN p_source = 'epo_ops' THEN left(p_evidence->>'abstract', 600) END) AS t
  )
  SELECT CASE
    WHEN p_source = 'sec_form_d' AND lower(e->>'industry_group') = 'biotechnology' THEN 'Health & Life Sciences'
    WHEN p_source = 'uk_companies_house' AND e->'codes' ? '72110'                  THEN 'Health & Life Sciences'
    WHEN p_source = 'uk_companies_house' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(e->'codes') = 'array' THEN e->'codes' ELSE '[]'::jsonb END) code
            WHERE code ~ '^26')                                                     THEN 'DeepTech'
    WHEN t ~* '\y(ai|llms?|machine learning|deep learning|neural|genai)\y'            THEN 'AI & ML'
    WHEN t ~* '\y(health|healthcare|healthtech|biotech|bioscience|biosciences|biologics|therapeutics|pharma|pharmaceuticals?|genomics|medical|medtech|clinical|diagnostics)\y'
                                                                                     THEN 'Health & Life Sciences'
    WHEN t ~* '\y(payments?|fintech|lending|neobank|insurtech|crypto|blockchain|wealthtech|regtech)\y'
                                                                                     THEN 'Fintech'
    WHEN t ~* '\y(cyber|cybersecurity|infosec)\y'                                    THEN 'Cybersecurity'
    WHEN t ~* '\y(solar|climate|carbon|battery|batteries|hydrogen|renewables?|cleantech)\y'
                                                                                     THEN 'Climate & Energy'
    WHEN t ~* '\y(quantum|robotics?|semiconductors?|photonics|aerospace|drones?)\y'   THEN 'DeepTech'
    WHEN t ~* '\y(gaming|games|edtech)\y'                                            THEN 'Consumer & Media'
    WHEN t ~* '\y(saas|devops|devtools)\y'                                           THEN 'SaaS & Dev Tools'
    WHEN t ~* '\y(ecommerce|e-commerce|marketplace|logistics)\y'                     THEN 'E-commerce & Retail'
    ELSE NULL
  END
  FROM x;
$$;

COMMENT ON FUNCTION candidate_sector(text, text, jsonb) IS
  'Parent sector (SECTOR_TAXONOMY) a candidate''s filing reveals, or NULL when it does not say. Structured signals first (SEC Biotechnology, UK SIC 72110 / 26xxx), then whole words of the name (and an EPO patent''s title/abstract).';

-- Onboarding stage steps (STAGE_STEPS in src/lib/taxonomy.ts) a filing is
-- consistent with — overlapping on purpose, a Form D amount is a hint, not a
-- round label. NULL = the filing says nothing about stage.
CREATE OR REPLACE FUNCTION candidate_stage_steps(p_source text, p_evidence jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  WITH a AS (
    SELECT CASE
      WHEN (p_evidence->>'total_offering') ~ '^[0-9]+(\.[0-9]+)?$' AND (p_evidence->>'total_offering')::numeric > 0
        THEN (p_evidence->>'total_offering')::numeric
      WHEN (p_evidence->>'total_sold') ~ '^[0-9]+(\.[0-9]+)?$' AND (p_evidence->>'total_sold')::numeric > 0
        THEN (p_evidence->>'total_sold')::numeric
    END AS amt
  )
  SELECT CASE
    WHEN p_source = 'uk_companies_house' THEN ARRAY['pre-seed', 'seed']
    WHEN p_source <> 'sec_form_d' OR amt IS NULL THEN NULL
    WHEN amt <   2500000 THEN ARRAY['pre-seed', 'seed']
    WHEN amt <  10000000 THEN ARRAY['seed', 'series-a']
    WHEN amt <  40000000 THEN ARRAY['series-a', 'series-b']
    ELSE                      ARRAY['series-b', 'growth']
  END
  FROM a;
$$;

-- ── 3. Does this user want an alert about this candidate? ───────────────────
CREATE OR REPLACE FUNCTION candidate_alert_wanted(p_user_id uuid, c company_candidates)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m        user_mandates;
  v_trig   text;
  v_steps  text[];
  v_sector text;
  v_wanted text[];
BEGIN
  SELECT * INTO m FROM user_mandates WHERE user_id = p_user_id;
  IF NOT FOUND OR NOT m.alerts_filtered THEN
    RETURN true;
  END IF;

  IF cardinality(m.geographies) > 0 AND NOT EXISTS (
       SELECT 1 FROM unnest(m.geographies) g WHERE lower(btrim(g)) = lower(btrim(c.country))) THEN
    RETURN false;
  END IF;

  v_trig := CASE c.source WHEN 'sec_form_d'         THEN 'pre_public_funding'
                          WHEN 'uk_companies_house' THEN 'company_registrations' END;
  IF m.signal_triggers && ARRAY['company_registrations', 'pre_public_funding']
     AND (v_trig IS NULL OR NOT v_trig = ANY (m.signal_triggers)) THEN
    RETURN false;
  END IF;

  v_steps := candidate_stage_steps(c.source, c.evidence);
  IF cardinality(m.stages) > 0 AND v_steps IS NOT NULL AND NOT (v_steps && m.stages) THEN
    RETURN false;
  END IF;

  SELECT array_agg(DISTINCT s) INTO v_wanted FROM (
    SELECT unnest(m.sectors) AS s
    UNION
    SELECT classify_sector_parent(st.industry)
      FROM watchlist_items wi JOIN startups st ON st.id = wi.entity_id
     WHERE wi.user_id = p_user_id AND wi.entity_type = 'startup'
  ) w WHERE s IS NOT NULL AND s <> 'Uncategorized';

  IF cardinality(v_wanted) > 0 THEN
    v_sector := candidate_sector(c.source, c.name, c.evidence);
    IF v_sector IS NULL OR NOT v_sector = ANY (v_wanted) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION candidate_alert_wanted(uuid, company_candidates) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION candidate_alert_wanted(uuid, company_candidates) TO service_role;

-- "$12M" / "$2.5M" / "$260K" — same rules as formatUsd() in src/lib/candidateReview.ts.
CREATE OR REPLACE FUNCTION format_usd_short(p numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL OR p <= 0 THEN NULL
    WHEN p >= 1000000000 THEN '$' || trim_scale(round(p / 1000000000, 1)) || 'B'
    WHEN p >= 1000000    THEN '$' || trim_scale(round(p / 1000000, 1)) || 'M'
    WHEN p >= 1000       THEN '$' || round(p / 1000) || 'K'
    ELSE '$' || round(p)
  END;
$$;

-- ── 4. The alert job ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_live_alerts(
  p_lookback_hours     integer DEFAULT 2,
  p_match_threshold    integer DEFAULT 85,
  p_velocity_min_stars integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  n_filing   integer;
  n_velocity integer;
  n_match    integer;
  n_company  integer;
BEGIN
  -- ── 1. Watchlist filing alerts ──────────────────────────────────────────
  WITH candidates AS (
    SELECT wi.user_id, f.id AS filing_id, f.source, f.entity_name, f.filing_date, f.startup_id
      FROM raw_gov_filings f
      JOIN watchlist_items wi
        ON wi.entity_type = 'startup' AND wi.entity_id = f.startup_id
     WHERE f.startup_id IS NOT NULL
       AND f.ingested_at >= now() - make_interval(hours => p_lookback_hours)
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      c.user_id,
      'watchlist_filing',
      'New filing: ' || c.entity_name,
      c.entity_name || ' filed a new ' ||
        CASE c.source
          WHEN 'sec_form_d'          THEN 'SEC Form D'
          WHEN 'uk_companies_house'  THEN 'UK Companies House'
          WHEN 'uspto_patent'        THEN 'USPTO patent'
          WHEN 'epo_ops'             THEN 'EPO patent'
          ELSE c.source
        END || ' filing on ' || to_char(c.filing_date, 'Mon DD, YYYY') || '.',
      '/startups?company=' || c.startup_id::text,              -- CHANGED: was '/my-area'
      'filing:' || c.filing_id::text
    FROM candidates c
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_filing FROM inserted;

  -- ── 2. Watchlist GitHub velocity spikes ──────────────────────────────────
  WITH candidates AS (
    SELECT wi.user_id, v.project_id, v.name, v.stars, v.stars_delta_1d, v.last_observed_at, v.startup_id
      FROM oss_project_velocity v
      JOIN watchlist_items wi
        ON wi.entity_type = 'startup' AND wi.entity_id = v.startup_id
     WHERE v.startup_id IS NOT NULL
       AND v.stars_delta_1d IS NOT NULL
       AND v.stars_delta_1d >= p_velocity_min_stars
       AND v.last_observed_at >= now() - make_interval(hours => p_lookback_hours)
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      c.user_id,
      'watchlist_velocity',
      c.name || ' is trending',
      c.name || ' gained ' || c.stars_delta_1d || ' GitHub stars in the last day (now ' || c.stars || ' total).',
      '/startups?company=' || c.startup_id::text,              -- CHANGED: was '/my-area'
      'velocity:' || c.project_id::text || ':' || c.last_observed_at::text
    FROM candidates c
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_velocity FROM inserted;

  -- ── 3. New high-match thesis alerts ──────────────────────────────────────
  -- Windowed on embedding_updated_at AND created_at within 14 days — see
  -- 20261003000000 and 20261015000000.
  WITH candidates AS (
    SELECT
      pv.user_id, s.id AS startup_id, s.name,
      GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer AS match_pct
    FROM startups s
    JOIN user_preference_vectors pv ON pv.signal_count >= 3
   WHERE s.embedding IS NOT NULL
     AND s.embedding_updated_at >= now() - make_interval(hours => p_lookback_hours)
     AND s.created_at >= now() - interval '14 days'
     AND NOT EXISTS (
       SELECT 1 FROM watchlist_items wi
        WHERE wi.user_id = pv.user_id AND wi.entity_type = 'startup' AND wi.entity_id = s.id)
     AND NOT EXISTS (
       SELECT 1 FROM user_interactions ui
        WHERE ui.user_id = pv.user_id AND ui.startup_id = s.id AND ui.action_type = 'pass')
     -- NEW: not if this user was already told about the company as a new
     -- candidate — approval turning it into a startups row is not news twice.
     AND NOT EXISTS (
       SELECT 1 FROM company_candidates cc
         JOIN notifications n ON n.user_id = pv.user_id AND n.dedupe_key = 'candidate:' || cc.id::text
        WHERE cc.startup_id = s.id)
  ), qualifying AS (
    SELECT * FROM candidates WHERE match_pct >= p_match_threshold
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      q.user_id,
      'thesis_match',
      'New ' || q.match_pct || '% match: ' || q.name,
      q.name || ' was just added and matches ' || q.match_pct || '% of your investment thesis.',
      '/startups?company=' || q.startup_id::text,              -- CHANGED: was '/my-area?tab=matches'
      'thesis_match:' || q.startup_id::text
    FROM qualifying q
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_match FROM inserted;

  -- ── 4. NEW: new companies found by the sourcing engine ──────────────────
  -- Alert-tier, not rejected, seen in the window (last_seen_at, so a queue
  -- candidate later upgraded to alert by a new filing is caught too; the
  -- dedupe key makes every later sighting a no-op).
  WITH pairs AS (
    SELECT u.id AS user_id, c.id, c.source, c.name, c.evidence,
           candidate_sector(c.source, c.name, c.evidence) AS sector
      FROM company_candidates c
      CROSS JOIN auth.users u
     WHERE c.gate_tier = 'alert'
       AND c.status <> 'rejected'
       AND c.last_seen_at >= now() - make_interval(hours => p_lookback_hours)
       AND candidate_alert_wanted(u.id, c)
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      p.user_id,
      'new_company',
      'New company: ' || p.name,
      CASE p.source
        WHEN 'sec_form_d' THEN
          p.name || ' filed an SEC Form D'
            || coalesce(' to raise ' || format_usd_short(
                 CASE WHEN (p.evidence->>'total_offering') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (p.evidence->>'total_offering')::numeric END), '')
            || coalesce(' (' || coalesce(p.sector, p.evidence->>'industry_group') || ')', '') || '.'
        ELSE
          p.name || ' was just registered at UK Companies House'
            || coalesce(' (' || p.sector || ')', '') || '.'
      END || ' Not yet reviewed by AlphaMap.',
      '/candidates/' || p.id::text,
      'candidate:' || p.id::text
    FROM pairs p
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_company FROM inserted;

  RETURN jsonb_build_object(
    'watchlist_filing_alerts',   n_filing,
    'watchlist_velocity_alerts', n_velocity,
    'thesis_match_alerts',       n_match,
    'new_company_alerts',        n_company
  );
END;
$$;

COMMENT ON FUNCTION generate_live_alerts(integer, integer, integer) IS
  'Scans a rolling lookback window for new watchlist filings, watchlist GitHub velocity spikes, high-scoring thesis matches on recently-created startups, and new alert-tier company candidates (per user, honoring user_mandates.alerts_filtered), inserting deduplicated notifications. Every alert links to the company (or the candidate preview). Safe to re-run on any schedule.';

REVOKE ALL ON FUNCTION generate_live_alerts(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_live_alerts(integer, integer, integer) TO service_role;

-- ── 5. Relink notifications already sent ─────────────────────────────────────
UPDATE notifications n
   SET link = '/startups?company=' || substr(n.dedupe_key, 14)
 WHERE n.dedupe_key ~ '^thesis_match:[0-9a-f-]{36}$'
   AND n.link = '/my-area?tab=matches'
   AND EXISTS (SELECT 1 FROM startups s WHERE s.id::text = substr(n.dedupe_key, 14));

UPDATE notifications n
   SET link = '/startups?company=' || f.startup_id::text
  FROM raw_gov_filings f
 WHERE n.dedupe_key ~ '^filing:[0-9a-f-]{36}$'
   AND f.id::text = substr(n.dedupe_key, 8)
   AND f.startup_id IS NOT NULL
   AND n.link = '/my-area';

-- ── 6. Candidate preview for signed-in users ────────────────────────────────
CREATE OR REPLACE FUNCTION get_candidate_preview(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c company_candidates;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM company_candidates WHERE id = p_candidate_id;
  IF NOT FOUND OR (c.gate_tier <> 'alert' AND NOT is_app_admin()) THEN
    RETURN NULL;
  END IF;
  IF c.status = 'rejected' THEN
    RETURN jsonb_build_object('id', c.id, 'status', c.status);
  END IF;

  RETURN jsonb_build_object(
    'id', c.id, 'status', c.status, 'startup_id', c.startup_id,
    'source', c.source, 'name', c.name, 'country', c.country, 'founded_year', c.founded_year,
    'cik', c.cik, 'entity_number', c.entity_number, 'website', c.website,
    'gate_tier', c.gate_tier, 'filings_count', c.filings_count, 'first_seen_at', c.first_seen_at,
    'evidence', c.evidence,
    'sector', candidate_sector(c.source, c.name, c.evidence)
  );
END;
$$;

COMMENT ON FUNCTION get_candidate_preview(uuid) IS
  'Read-only preview of a company candidate for the /candidates/:id page a new-company alert links to. Alert-tier candidates for any signed-in user (queue-tier for admins only); a rejected candidate returns only its status; an approved one carries startup_id so the page can forward to the company.';

REVOKE ALL ON FUNCTION get_candidate_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_candidate_preview(uuid) TO authenticated, service_role;
