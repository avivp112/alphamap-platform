-- =============================================================================
-- Migration: entity resolvers — tier 1 auto-merge, tiers 2/3 review queue
-- Created:   2026-07-26
-- Description:
--   The substrate (20260726180000) stores identifiers and candidates; the merge
--   machinery (20260726190000) executes a merge. This is the part that decides
--   WHICH rows are the same company.
--
-- ── WHY company_identifiers CANNOT FIND THE BACKLOG ─────────────────────────
--   company_identifiers is UNIQUE (kind, value) globally, so two startups can
--   never both hold the same domain or CIK — the second insert is rejected, and
--   that rejection IS the duplicate signal at ingest time.
--
--   Which means it is structurally incapable of surfacing duplicates that
--   already exist: those rows predate the constraint and never both got an
--   identifier row. The resolvers therefore derive identity from SOURCE columns
--   (startups.website, raw_gov_filings.cik / entity_number) rather than from
--   the identifier table. Going forward the constraint prevents new duplicates;
--   these functions clear what is already there.
--
-- ── THE TIER POLICY, AND WHY TIER 2 DOES NOT AUTO-MERGE ─────────────────────
--   Measured on production: 5,566 companies, 13 domain-collision groups (16
--   redundant rows) and 60 exact-normalised-name groups (62 redundant rows).
--   A 1.4% duplicate rate.
--
--     TIER 1  A shared STRONG identifier — registrable domain, SEC CIK,
--             Companies House number. Two rows with the same registrable domain
--             are the same company; there is no realistic false positive.
--             AUTO-MERGES.
--
--     TIER 2  Identical normalised name PLUS a corroborating attribute
--             (country, founded_year or city). QUEUES for review.
--
--     TIER 3  Trigram similarity above threshold. QUEUES for review.
--
--   Tier 2 does not auto-merge, and the numbers are the argument. Sixty groups
--   is an afternoon for the reviewer who already owns this queue. Weighed
--   against a wrong link — which is invisible, self-reinforcing, and destroys
--   the credibility of every downstream signal — automating away sixty
--   decisions is a bad trade. Name equality is a weak signal wearing a strong
--   signal's clothes: 'Apex Capital' and 'Vertex Labs' recur across
--   jurisdictions with no relationship whatsoever.
--
--   If Tier 2 precision proves out over a few weeks, promoting it is a one-line
--   change to p_auto in queue_tier2_candidates(). The reverse — un-merging
--   sixty wrong merges — is not one line, and unmerge_company() explicitly
--   cannot restore the relationships it repointed.
--
-- ── DRY RUN IS THE DEFAULT ──────────────────────────────────────────────────
--   resolve_tier1() defaults to p_dry_run => true and reports what it WOULD do.
--   The destructive call has to be typed deliberately. A resolver that merges
--   on first invocation is one fat finger away from an unrecoverable afternoon.
--
-- Rollback: supabase/rollback/20260726200000_entity_resolvers_down.sql
-- Tests:    supabase/tests/entity_resolvers.test.sql
--
-- Idempotent.
-- =============================================================================

/**
 * Every group of startups that share a STRONG identifier.
 *
 * Returns one row per (kind, value) held by two or more distinct startups.
 * Deliberately excludes name_norm: a normalised name is not a strong identifier
 * and feeding it in here would auto-merge unrelated companies.
 */
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
  HAVING count(DISTINCT g.startup_id) > 1;
$$;

COMMENT ON FUNCTION strong_identity_groups() IS
  'Groups of startups sharing a strong identifier (domain, CIK, Companies House number), derived from source columns rather than company_identifiers — which is UNIQUE(kind,value) and so cannot represent a duplicate at all.';

/**
 * Tier 1: merge every group that shares a strong identifier.
 *
 * DRY RUN BY DEFAULT. Pass p_dry_run => false to actually merge.
 *
 * Within a group the richest row survives (company_richness decides) and the
 * rest are merged into it one at a time. Groups of three or more collapse to a
 * single row rather than a chain of pairs.
 */
CREATE OR REPLACE FUNCTION resolve_tier1(
  p_limit   integer DEFAULT 50,
  p_dry_run boolean DEFAULT true,
  p_by      text    DEFAULT 'resolve_tier1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grp        record;
  survivor   uuid;
  loser      uuid;
  best       integer;
  cur        integer;
  cand       uuid;
  detail     jsonb := '[]'::jsonb;
  n_groups   integer := 0;
  n_merges   integer := 0;
  merged_ids uuid[];
BEGIN
  FOR grp IN
    SELECT * FROM strong_identity_groups() ORDER BY kind, value LIMIT p_limit
  LOOP
    -- A previous group in THIS run may already have merged one of these rows
    -- away — the same pair can share both a domain and a CIK. Re-check
    -- existence rather than trusting the snapshot the loop opened with.
    SELECT array_agg(id) INTO merged_ids
      FROM startups WHERE id = ANY(grp.startup_ids);
    CONTINUE WHEN merged_ids IS NULL OR array_length(merged_ids, 1) < 2;

    n_groups := n_groups + 1;

    -- Richest row in the group survives.
    survivor := NULL; best := -1;
    FOREACH cand IN ARRAY merged_ids LOOP
      cur := company_richness(cand);
      IF cur > best THEN best := cur; survivor := cand; END IF;
    END LOOP;

    FOREACH loser IN ARRAY merged_ids LOOP
      CONTINUE WHEN loser = survivor;

      detail := detail || jsonb_build_object(
        'kind', grp.kind, 'value', grp.value,
        'survivor', survivor, 'merged', loser);

      IF NOT p_dry_run THEN
        -- The audit goes to company_merges and ONLY there. Writing an
        -- 'auto_linked' row to entity_match_candidates was the obvious move and
        -- it does not work: right_startup_id is ON DELETE CASCADE, so the row
        -- is destroyed by the very merge it documents. Repointing it instead
        -- makes left_id = right_startup_id and trips entity_match_no_self.
        --
        -- That table holds PROPOSALS about rows that still exist. A completed
        -- merge is company_merges' job, and the evidence below carries
        -- everything a reviewer would want: tier, which identifier matched, and
        -- its value.
        PERFORM merge_companies(
          survivor, loser, survivor,
          jsonb_build_object('tier', 1, 'kind', grp.kind, 'value', grp.value,
                             'auto', true),
          p_by);
      END IF;

      n_merges := n_merges + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'groups',  n_groups,
    'merges',  n_merges,
    'detail',  detail);
END;
$$;

COMMENT ON FUNCTION resolve_tier1(integer, boolean, text) IS
  'Merges startups sharing a strong identifier. DRY RUN BY DEFAULT — pass p_dry_run => false to execute. The richest row in each group survives; groups of three or more collapse to one row.';

/**
 * Tier 2: identical normalised name PLUS a corroborating attribute.
 *
 * Queues for review; does NOT merge. See the tier policy at the top of this
 * file for why. p_auto exists so the policy can be flipped later without a
 * rewrite, and defaults to false.
 *
 * Pairs are stored canonically (LEAST, GREATEST) so the unique constraint
 * actually deduplicates — (A,B) and (B,A) would otherwise both be storable and
 * the reviewer would see the same pair twice.
 */
CREATE OR REPLACE FUNCTION queue_tier2_candidates(
  p_limit integer DEFAULT 500,
  p_auto  boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH pairs AS (
    SELECT LEAST(a.id, b.id)    AS lo,
           GREATEST(a.id, b.id) AS hi,
           normalize_company_name(a.name) AS nm,
           -- Which attributes agree. Name equality alone is NOT enough: the
           -- corroborator is what separates a duplicate from a coincidence.
           (a.country      IS NOT NULL AND a.country      = b.country)      AS same_country,
           (a.founded_year IS NOT NULL AND a.founded_year = b.founded_year) AS same_year,
           (a.city         IS NOT NULL AND a.city         = b.city)         AS same_city
      FROM startups a
      JOIN startups b
        ON b.id > a.id
       AND normalize_company_name(b.name) = normalize_company_name(a.name)
     WHERE normalize_company_name(a.name) IS NOT NULL
  ), corroborated AS (
    SELECT *,
           (same_country::int + same_year::int + same_city::int) AS agree
      FROM pairs
     WHERE same_country OR same_year OR same_city
  )
  INSERT INTO entity_match_candidates (
    left_kind, left_id, right_startup_id, tier, score, evidence, status)
  SELECT 'startup', lo, hi, 2,
         -- 0.70 for the name, plus 0.10 per corroborating attribute.
         LEAST(0.700 + 0.100 * agree, 1.000),
         jsonb_build_object('name_norm', nm, 'same_country', same_country,
                            'same_founded_year', same_year, 'same_city', same_city),
         CASE WHEN p_auto THEN 'auto_linked' ELSE 'pending' END
    FROM corroborated
   ORDER BY agree DESC, lo
   LIMIT p_limit
  ON CONFLICT ON CONSTRAINT entity_match_candidates_unique_pair DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION queue_tier2_candidates(integer, boolean) IS
  'Queues pairs with an identical normalised name AND at least one corroborating attribute. Does not merge: name equality is a weak signal and a wrong link is invisible once made. Pairs are stored canonically so re-running never double-queues.';

/**
 * Tier 3: fuzzy name similarity, for the human queue.
 *
 * Excludes exact normalised-name matches — those are tier 2's job, and queuing
 * them twice would show the reviewer the same pair under two tiers.
 *
 * The trigram index on normalize_company_name(name) (created in 20260726180000)
 * is what makes the % operator affordable here; without it this is a cross
 * join over 5.5k rows.
 */
CREATE OR REPLACE FUNCTION queue_tier3_candidates(
  p_threshold numeric DEFAULT 0.86,
  p_limit     integer DEFAULT 200
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF p_threshold <= 0 OR p_threshold >= 1 THEN
    RAISE EXCEPTION 'queue_tier3_candidates: threshold must be between 0 and 1 (got %)', p_threshold;
  END IF;

  WITH pairs AS (
    SELECT LEAST(a.id, b.id)    AS lo,
           GREATEST(a.id, b.id) AS hi,
           normalize_company_name(a.name) AS a_nm,
           normalize_company_name(b.name) AS b_nm,
           similarity(normalize_company_name(a.name),
                      normalize_company_name(b.name)) AS sim
      FROM startups a
      JOIN startups b
        ON b.id > a.id
       AND normalize_company_name(b.name) % normalize_company_name(a.name)
       AND normalize_company_name(b.name) <> normalize_company_name(a.name)
     WHERE normalize_company_name(a.name) IS NOT NULL
       AND normalize_company_name(b.name) IS NOT NULL
  )
  INSERT INTO entity_match_candidates (
    left_kind, left_id, right_startup_id, tier, score, evidence, status)
  SELECT 'startup', lo, hi, 3, round(sim::numeric, 3),
         jsonb_build_object('left_name_norm', a_nm, 'right_name_norm', b_nm,
                            'similarity', round(sim::numeric, 3)),
         'pending'
    FROM pairs
   WHERE sim >= p_threshold
   ORDER BY sim DESC, lo
   LIMIT p_limit
  ON CONFLICT ON CONSTRAINT entity_match_candidates_unique_pair DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION queue_tier3_candidates(numeric, integer) IS
  'Queues fuzzy name matches above a similarity threshold for human review. Excludes exact normalised-name matches, which tier 2 already covers.';

/**
 * The reviewer's verb. Confirm a queued pair (which merges it) or reject it.
 *
 * Rejecting is not a no-op: the row stays, marked rejected, and the unique
 * constraint then stops the resolver ever proposing that pair again. A queue
 * that re-suggests what a human already declined trains the human to stop
 * reading it.
 */
CREATE OR REPLACE FUNCTION decide_match_candidate(
  p_candidate_id uuid,
  p_decision     text,
  p_by           text,
  p_survivor_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        record;
  merge_id uuid;
BEGIN
  IF p_decision NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'decide_match_candidate: decision must be confirmed or rejected (got %)', p_decision;
  END IF;

  SELECT * INTO c FROM entity_match_candidates WHERE id = p_candidate_id;
  IF c IS NULL THEN
    RAISE EXCEPTION 'decide_match_candidate: no candidate %', p_candidate_id;
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'decide_match_candidate: candidate % is already %', p_candidate_id, c.status;
  END IF;
  IF c.left_kind <> 'startup' THEN
    RAISE EXCEPTION 'decide_match_candidate: only startup-to-startup pairs can be merged here (got %)', c.left_kind;
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE entity_match_candidates
       SET status = 'rejected', decided_by = p_by, decided_at = now()
     WHERE id = p_candidate_id;
    RETURN NULL;
  END IF;

  -- Confirmed.
  --
  -- THIS CANDIDATE ROW WILL NOT SURVIVE THE MERGE, and that is expected rather
  -- than a defect to route around. right_startup_id is ON DELETE CASCADE, so
  -- deleting the merged-away company destroys it; and repointing it instead
  -- would make left_id = right_startup_id, which entity_match_no_self forbids.
  -- Either way the proposal ceases to exist, correctly — the two rows it
  -- described are now one row.
  --
  -- The durable record of the decision is the company_merges row created below:
  -- merged_by names the reviewer, and the evidence carries the candidate id and
  -- tier. Do not add an audit row here expecting to find it later.
  --
  -- The status is still set first so that if merge_companies() raises, the
  -- whole call rolls back together and the candidate stays pending rather than
  -- being marked decided on a merge that never happened.
  UPDATE entity_match_candidates
     SET status = 'confirmed', decided_by = p_by, decided_at = now()
   WHERE id = p_candidate_id;

  merge_id := merge_companies(c.left_id, c.right_startup_id, p_survivor_id,
                              c.evidence || jsonb_build_object('tier', c.tier,
                                                               'candidate_id', c.id),
                              p_by);
  RETURN merge_id;
END;
$$;

COMMENT ON FUNCTION decide_match_candidate(uuid, text, text, uuid) IS
  'Reviewer decision on a queued pair. Confirm merges it; reject records the refusal so the resolver never proposes that pair again. The candidate row is marked BEFORE the merge, because the merge can cascade-delete the candidate itself.';

REVOKE ALL ON FUNCTION strong_identity_groups()                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION resolve_tier1(integer, boolean, text)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION queue_tier2_candidates(integer, boolean)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION queue_tier3_candidates(numeric, integer)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION decide_match_candidate(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION strong_identity_groups()                  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION resolve_tier1(integer, boolean, text)     TO service_role;
GRANT EXECUTE ON FUNCTION queue_tier2_candidates(integer, boolean)  TO service_role;
GRANT EXECUTE ON FUNCTION queue_tier3_candidates(numeric, integer)  TO service_role;
-- authenticated too: the reviewer works through the app, not psql.
GRANT EXECUTE ON FUNCTION decide_match_candidate(uuid, text, text, uuid) TO service_role, authenticated;
