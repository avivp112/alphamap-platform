-- =============================================================================
-- Migration: OSS project -> startup linker, and Tier 1 extended to
--            github_org / hf_org / ats_token
-- Created:   2026-07-26
-- Description:
--   Sourcing Engine audit, Phase 3 (Steps 3-4).
--
-- ── STEP 3: oss_projects.startup_id HAS NEVER BEEN WRITTEN ──────────────────
--   record_oss_observation() (20260726140000) upserts a project and appends a
--   metrics row; nothing in the ingest path, and no separate resolver, ever
--   sets startup_id. Every GitHub repo and Hugging Face model this pipeline
--   has ever ingested is an orphan. This adds the resolver that was missing.
--
--   A repo or model existing is NOT evidence a company has been formed --
--   that is the entire premise of this layer (see 20260726140000's header).
--   So, unlike ingest_gov_entity_filing(), this NEVER creates a startups row
--   and NEVER falls back to name matching -- a GitHub org called "atlas" and
--   a startup called "Atlas" are coincidence far more often than not. It only
--   links a project to a startup that ALREADY EXISTS, on evidence that
--   cannot be coincidence:
--
--     1. IDENTIFIER: owner_login already recorded as a github_org/hf_org
--        identifier for some startup (from a previous run of this same
--        function, or a manual/reviewed link). Resolves instantly.
--     2. DOMAIN: the project's homepage, when present, shares a registrable
--        domain with a startup's website. This is the only path capable of
--        making the FIRST link for a given owner -- once made, the owner's
--        github_org/hf_org identifier is recorded, so every other project
--        under that owner resolves via (1) on the next run without ever
--        needing a homepage.
--
--   Projects that resolve neither way stay unlinked. That is the correct,
--   expected steady state for most of this table, not a gap to close.
--
--   Owners in oss_excluded_owners are skipped outright, as a second line of
--   defence: the ingesters already filter them, but this is cheap insurance
--   against ever hanging a startups row off Google or the Apache Foundation.
--
--   DRY RUN BY DEFAULT, matching resolve_tier1()'s convention for every
--   writing function in this layer.
--
-- ── STEP 4: TIER 1 NEVER COVERED github_org / hf_org / ats_token ────────────
--   company_identifiers.kind has allowed these three since the table was
--   created (20260726180000) but strong_identity_groups() only ever looked
--   for domain/cik/ch_number collisions. Two startups rows that both got
--   linked to the same GitHub org, HF namespace, or ATS board token were
--   invisible to Tier 1 auto-merge. Added as three more UNION ALL branches,
--   read from the same SOURCE tables the identifiers are minted from
--   (oss_projects, sourcing_companies) rather than from company_identifiers
--   itself -- for the same reason the existing three branches don't read
--   company_identifiers: that table is UNIQUE(kind,value), so it can never
--   itself hold two rows for the same value and is structurally incapable
--   of surfacing a duplicate that predates the link.
--
-- Rollback: supabase/rollback/20260726230000_oss_startup_linker_down.sql
-- Idempotent.
-- =============================================================================

-- ── Step 3: oss_projects -> startups ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION link_oss_projects(
  p_limit   integer DEFAULT 500,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proj      record;
  v_kind    text;
  v_startup uuid;
  v_domain  text;
  v_method  text;
  detail    jsonb := '[]'::jsonb;
  n_seen    integer := 0;
  n_linked  integer := 0;
BEGIN
  FOR proj IN
    SELECT p.id, p.source, p.owner_login, p.homepage
      FROM oss_projects p
     WHERE p.startup_id IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM oss_excluded_owners e WHERE e.owner_login = p.owner_login)
     ORDER BY p.last_seen_at DESC
     LIMIT p_limit
  LOOP
    n_seen    := n_seen + 1;
    v_startup := NULL;
    v_domain  := NULL;
    v_method  := NULL;
    v_kind    := CASE WHEN proj.source = 'github_repo' THEN 'github_org' ELSE 'hf_org' END;

    -- 1. Identifier lookup: this owner already resolved to a startup before.
    SELECT startup_id INTO v_startup
      FROM company_identifiers
     WHERE kind = v_kind AND value = proj.owner_login
     LIMIT 1;
    IF v_startup IS NOT NULL THEN v_method := 'identifier'; END IF;

    -- 2. Domain lookup: the FIRST link for a given owner has to come from
    --    somewhere other than the identifier table, or no owner would ever
    --    resolve at all.
    IF v_startup IS NULL AND proj.homepage IS NOT NULL THEN
      v_domain := registrable_domain(proj.homepage);
      IF v_domain IS NOT NULL THEN
        SELECT startup_id INTO v_startup
          FROM company_identifiers
         WHERE kind = 'domain' AND value = v_domain
         LIMIT 1;
        IF v_startup IS NOT NULL THEN v_method := 'domain'; END IF;
      END IF;
    END IF;

    CONTINUE WHEN v_startup IS NULL;

    n_linked := n_linked + 1;
    detail := detail || jsonb_build_object(
      'project_id', proj.id, 'source', proj.source, 'owner_login', proj.owner_login,
      'startup_id', v_startup, 'method', v_method);

    IF NOT p_dry_run THEN
      UPDATE oss_projects SET startup_id = v_startup WHERE id = proj.id;

      -- Record the owner identifier so every other project under this same
      -- owner resolves via (1) on the next run, whether or not IT has a
      -- homepage. ON CONFLICT DO NOTHING: if a different startup somehow
      -- already claims this owner_login, that collision is a duplicate
      -- signal for Tier 1 (Step 4 below) to pick up, not this function's
      -- call to adjudicate.
      INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
      VALUES (v_startup, v_kind, proj.owner_login,
              'oss_projects.owner_login via ' || v_method, 0.90)
      ON CONFLICT (kind, value) DO NOTHING;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run, 'seen', n_seen, 'linked', n_linked, 'detail', detail);
END;
$$;

COMMENT ON FUNCTION link_oss_projects(integer, boolean) IS
  'Links oss_projects to an EXISTING startup only -- never creates one, never falls back to name matching. Resolves by a previously-recorded github_org/hf_org identifier first, then by the project''s homepage sharing a registrable domain with a startup''s website; a domain match also records the owner identifier so every other project under that owner resolves without needing a homepage. Projects that resolve neither way stay unlinked, which is the expected state for most rows: an OSS project existing is not evidence a company has incorporated. DRY RUN BY DEFAULT.';

REVOKE ALL ON FUNCTION link_oss_projects(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION link_oss_projects(integer, boolean) TO service_role;

-- ── Step 4: Tier 1 extended ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION strong_identity_groups()
RETURNS TABLE (kind text, value text, startup_ids uuid[])
LANGUAGE sql
STABLE
AS $$
  -- Registrable domain off the website column. The strongest signal available:
  -- two companies do not share an eTLD+1.
  SELECT 'domain'::text, registrable_domain(s.website), array_agg(DISTINCT s.id)
    FROM startups s
   WHERE s.website IS NOT NULL
     AND registrable_domain(s.website) IS NOT NULL
   GROUP BY 2
  HAVING count(DISTINCT s.id) > 1

  UNION ALL

  -- SEC Central Index Key, via the filings already linked to companies.
  SELECT 'cik'::text, g.cik, array_agg(DISTINCT g.startup_id)
    FROM raw_gov_filings g
   WHERE g.source = 'sec_form_d'
     AND g.startup_id IS NOT NULL
     AND btrim(coalesce(g.cik, '')) <> ''
   GROUP BY 2
  HAVING count(DISTINCT g.startup_id) > 1

  UNION ALL

  -- UK Companies House company number.
  SELECT 'ch_number'::text, g.entity_number, array_agg(DISTINCT g.startup_id)
    FROM raw_gov_filings g
   WHERE g.source = 'uk_companies_house'
     AND g.startup_id IS NOT NULL
     AND btrim(coalesce(g.entity_number, '')) <> ''
   GROUP BY 2
  HAVING count(DISTINCT g.startup_id) > 1

  UNION ALL

  -- NEW. GitHub org: the same owner_login linked from two different startups'
  -- repos. Read from oss_projects, not company_identifiers, for the same
  -- reason as the two branches above -- company_identifiers is
  -- UNIQUE(kind,value) and so cannot itself represent this collision.
  SELECT 'github_org'::text, p.owner_login, array_agg(DISTINCT p.startup_id)
    FROM oss_projects p
   WHERE p.source = 'github_repo'
     AND p.startup_id IS NOT NULL
   GROUP BY 2
  HAVING count(DISTINCT p.startup_id) > 1

  UNION ALL

  -- NEW. Hugging Face namespace: same owner_login across models/datasets/spaces.
  SELECT 'hf_org'::text, p.owner_login, array_agg(DISTINCT p.startup_id)
    FROM oss_projects p
   WHERE p.source IN ('huggingface_model', 'huggingface_dataset', 'huggingface_space')
     AND p.startup_id IS NOT NULL
   GROUP BY 2
  HAVING count(DISTINCT p.startup_id) > 1

  UNION ALL

  -- NEW. ATS board token: correct by construction (discovery starts from a
  -- startups row and probes outward), but a manual re-point or a merge that
  -- should have run first can still put two rows on record for one board.
  SELECT 'ats_token'::text, c.ats_board_token, array_agg(DISTINCT c.startup_id)
    FROM sourcing_companies c
   WHERE c.startup_id IS NOT NULL
     AND c.ats_board_token IS NOT NULL
   GROUP BY 2
  HAVING count(DISTINCT c.startup_id) > 1;
$$;

COMMENT ON FUNCTION strong_identity_groups() IS
  'Groups of startups sharing a strong identifier: domain, CIK, Companies House number, GitHub org, Hugging Face namespace, or ATS board token. Each branch is derived from the source column/table an identifier was minted from, never from company_identifiers itself -- that table is UNIQUE(kind,value) and so cannot represent a duplicate that predates the link.';

-- resolve_tier1() (20260726200000) iterates strong_identity_groups() generically
-- by kind/value/startup_ids and needs no change to pick up the three new kinds.
