-- =============================================================================
-- Migration: wire SEC Form D into the sourcing pipeline
-- Created:   2026-07-26
-- Description:
--   Four things, in dependency order:
--     1. gov_company_slug()          — legal name -> probeable slug
--     2. ingest_form_d_filing()      — the transactional upsert the Edge
--                                      Function calls, once per filing
--     3. board_discovery_candidates  — admit companies that have a filing but
--                                      no website, and expose their slug
--     4. sourcing_fomo_scores        — add pts_inception
--
-- ── 2 IS AN RPC AND NOT THREE POSTGREST CALLS, FOR TWO REASONS ──────────────
--   startups.slug is covered by a PARTIAL unique index (uq_startups_slug ...
--   WHERE slug IS NOT NULL). Postgres cannot infer a partial index for ON
--   CONFLICT unless the statement repeats its predicate, and PostgREST does not
--   emit one — so `.upsert(..., { onConflict: "slug" })` fails outright. The
--   upsert has to happen where the predicate can be written.
--
--   And it must be atomic. Creating the startups row, then failing to write the
--   filing, would leave an entity with no evidence behind it — which is exactly
--   the row nobody can later explain. One function, one transaction.
--
-- ── ON NOT WRITING SEC'S INDUSTRY INTO startups.industry ────────────────────
--   Tempting, and wrong. classify_sector_parent() has no patterns for SEC's
--   vocabulary: 'Computers', 'Other Technology' and 'Technology' all fall
--   through to 'Uncategorized'. board_discovery_candidates admits Uncategorized
--   ONLY when the industry is blank — a non-blank industry that classifies as
--   Uncategorized is excluded. So writing 'Computers' there would file every
--   Form D company under a category that then hides it from the very queue this
--   layer exists to fill.
--
--   startups.industry therefore stays NULL and the SEC value lives in
--   raw_gov_filings.industry_group. Tech filtering happens in the ingester
--   against SEC's own taxonomy, which is a filer-declared classification and
--   strictly better evidence than keyword-matching a company name.
--
-- Rollback: supabase/rollback/20260726120000_form_d_pipeline_down.sql
--
-- Idempotent.
-- =============================================================================

-- ── 1. Slug derivation ──────────────────────────────────────────────────────
-- Form D carries the LEGAL name — "ACME ROBOTICS, INC." — while an ATS board
-- lives at "acmerobotics". Feeding the raw legal name to the prober would spend
-- every request on slugs ending "-inc" that cannot exist.
--
-- Only true legal suffixes are stripped. NOT "labs", "technologies" or
-- "holdings": those are part of how the company is actually known and usually
-- part of the real slug ("pikalabs"), so stripping them would break more than
-- it fixed. Applied twice for stacked suffixes ("ACME HOLDINGS, LLC.").
CREATE OR REPLACE FUNCTION gov_company_slug(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH base AS (
    SELECT lower(btrim(coalesce(p_name, ''))) AS n
  ), amp AS (
    SELECT replace(n, '&', ' and ') AS n FROM base
  ), strip1 AS (
    SELECT regexp_replace(n,
      '[[:space:],\.]+(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|plc|pbc|gmbh|s\.a|n\.v|b\.v|pty|ag)\.?$',
      '') AS n FROM amp
  ), strip2 AS (
    SELECT regexp_replace(n,
      '[[:space:],\.]+(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|plc|pbc|gmbh|s\.a|n\.v|b\.v|pty|ag)\.?$',
      '') AS n FROM strip1
  ), slugged AS (
    SELECT btrim(regexp_replace(regexp_replace(n, '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), '-') AS s
    FROM strip2
  )
  -- One-character slugs match half the internet; not worth a request. Same
  -- rule discover-boards applies to domain labels.
  SELECT CASE WHEN length(s) >= 2 THEN s END FROM slugged;
$$;

COMMENT ON FUNCTION gov_company_slug(text) IS
  'Legal entity name -> ATS-probeable slug. Strips true legal suffixes (Inc/LLC/Corp...) but never brand words like Labs or Technologies, which are usually part of the real slug. Returns NULL for anything under two characters.';

-- ── 2. Transactional ingest of one filing ───────────────────────────────────
CREATE OR REPLACE FUNCTION ingest_form_d_filing(
  p_accession      text,
  p_cik            text,
  p_form_type      text,
  p_entity_name    text,
  p_filing_date    date,
  p_year_of_inc    integer,
  p_jurisdiction   text,
  p_industry_group text,
  p_officers       jsonb,
  p_tech_summary   text,
  p_total_offering numeric,
  p_total_sold     numeric,
  p_raw            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug       text;
  v_startup_id uuid;
  v_created    boolean := false;
  v_year       integer;
  v_filing_id  uuid;
BEGIN
  IF p_entity_name IS NULL OR btrim(p_entity_name) = '' THEN
    RAISE EXCEPTION 'ingest_form_d_filing: entity_name is required';
  END IF;
  IF p_accession IS NULL OR btrim(p_accession) = '' THEN
    RAISE EXCEPTION 'ingest_form_d_filing: accession_number is required (it is the dedupe key)';
  END IF;

  v_slug := gov_company_slug(p_entity_name);

  -- startups.founded_year carries CHECK (> 1900 AND <= current year). An
  -- issuer typo — 20024, or a year in the future — would abort the whole
  -- filing. Drop the value instead: a missing founding year costs 0 points in
  -- the FOMO score, while a lost filing costs the entire company. The raw
  -- value is preserved unclamped in raw_gov_filings.year_of_inc.
  v_year := p_year_of_inc;
  IF v_year IS NOT NULL AND (v_year <= 1900 OR v_year > EXTRACT(YEAR FROM now())::integer) THEN
    v_year := NULL;
  END IF;

  -- Match an existing entity. Exact case-insensitive name first — the highest
  -- precision signal we have — then the derived slug, which catches
  -- "Acme Robotics" vs "ACME ROBOTICS, INC.".
  SELECT id INTO v_startup_id
    FROM startups
   WHERE lower(btrim(name)) = lower(btrim(p_entity_name))
   ORDER BY created_at
   LIMIT 1;

  IF v_startup_id IS NULL AND v_slug IS NOT NULL THEN
    SELECT id INTO v_startup_id FROM startups WHERE slug = v_slug LIMIT 1;
  END IF;

  IF v_startup_id IS NULL THEN
    INSERT INTO startups (name, slug, founded_year, country)
    VALUES (
      btrim(p_entity_name),
      -- Claim the slug only if free. Two unrelated issuers can normalise to
      -- the same string; losing the slug is survivable, violating the unique
      -- index would abort the filing.
      CASE WHEN v_slug IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.slug = v_slug)
           THEN v_slug END,
      v_year,
      'United States'   -- Form D is a US federal filing by definition
    )
    RETURNING id INTO v_startup_id;
    v_created := true;
  ELSE
    -- COALESCE, never overwrite. An enriched row may already hold a founding
    -- year from a better source; the issuer's own filing is good evidence but
    -- it is not a reason to clobber what is already there.
    UPDATE startups
       SET founded_year = COALESCE(founded_year, v_year),
           slug         = COALESCE(
                            slug,
                            CASE WHEN v_slug IS NOT NULL
                                  AND NOT EXISTS (
                                        SELECT 1 FROM startups s
                                         WHERE s.slug = v_slug AND s.id <> v_startup_id)
                                 THEN v_slug END),
           updated_at   = now()
     WHERE id = v_startup_id;
  END IF;

  INSERT INTO raw_gov_filings (
    source, accession_number, cik, form_type, entity_name, filing_date,
    year_of_inc, jurisdiction, industry_group, officers, tech_summary,
    total_offering, total_sold, raw_payload, startup_id
  ) VALUES (
    'sec_form_d', btrim(p_accession), p_cik, p_form_type, btrim(p_entity_name), p_filing_date,
    p_year_of_inc, p_jurisdiction, p_industry_group, COALESCE(p_officers, '[]'::jsonb), p_tech_summary,
    p_total_offering, p_total_sold, p_raw, v_startup_id
  )
  ON CONFLICT (source, accession_number) DO UPDATE
    SET startup_id   = COALESCE(raw_gov_filings.startup_id, EXCLUDED.startup_id),
        officers     = EXCLUDED.officers,
        tech_summary = EXCLUDED.tech_summary,
        raw_payload  = EXCLUDED.raw_payload
  RETURNING id INTO v_filing_id;

  RETURN jsonb_build_object(
    'filing_id',       v_filing_id,
    'startup_id',      v_startup_id,
    'created_startup', v_created,
    'slug',            v_slug,
    'founded_year',    v_year
  );
END;
$$;

COMMENT ON FUNCTION ingest_form_d_filing IS
  'Transactionally records one Form D filing and upserts its issuer into startups. Exists as an RPC because startups.slug is covered by a PARTIAL unique index that PostgREST cannot target with onConflict, and because a startups row must never exist without the filing that justifies it.';

-- Ingestion is a service-role job. Never expose an entity-creating function
-- to client roles.
REVOKE ALL ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb) TO service_role;

-- ── 3. Candidates: admit filing-backed companies with no website ────────────
-- The original rule was "a website is the only source of a candidate slug. No
-- site, no guess." That was right when the only input was an enrichment feed
-- where a missing website meant a thin, low-confidence row.
--
-- A Form D company breaks the assumption. It has no website because it
-- INCORPORATED EIGHT WEEKS AGO — and it is simultaneously the highest-signal
-- row in the table: a filed federal document, a named officer list, a declared
-- incorporation year and a closed round. Excluding it for lacking a marketing
-- site would drop precisely the companies this layer was built to find.
--
-- So the website requirement is relaxed for filing-backed rows only. Every
-- other company still needs a website, and the ~970 site-less rows already in
-- startups stay out of the queue.
DROP VIEW IF EXISTS board_discovery_candidates;

CREATE VIEW board_discovery_candidates AS
SELECT
  s.id                                                       AS startup_id,
  s.name,
  s.website,
  s.industry,
  -- The probeable slug, best-effort. Prefer the stored slug, fall back to
  -- deriving one, so the prober never has to slugify a legal name itself.
  COALESCE(s.slug, gov_company_slug(s.name))                 AS slug,
  COALESCE(sec.name, classify_sector_parent(s.industry))     AS sector_parent,
  classify_company_archetype(s.id)->>'archetype'             AS archetype,
  s.founded_year,
  -- Why this row qualifies, so a surprising queue can be explained without
  -- re-deriving the predicate by hand.
  CASE WHEN s.website IS NOT NULL AND btrim(s.website) <> '' THEN 'website'
       ELSE 'gov_filing' END                                 AS slug_source,
  s.created_at
FROM startups s
LEFT JOIN sectors sec ON sec.id = s.sector_id
WHERE
  -- A website, OR a government filing vouching that the company exists.
  (
        (s.website IS NOT NULL AND btrim(s.website) <> '')
     OR EXISTS (SELECT 1 FROM raw_gov_filings f WHERE f.startup_id = s.id)
  )
  -- Something to actually probe with.
  AND COALESCE(s.slug, gov_company_slug(s.name)) IS NOT NULL
  -- Not yet attempted.
  AND s.board_discovery_at IS NULL
  -- Not a demonstrably mature company. Fails open: no funding/age/headcount
  -- data classifies as venture_backed, so stealth companies stay in.
  AND classify_company_archetype(s.id)->>'archetype' <> 'mature_private'
  -- Tech sectors, PLUS companies whose industry we simply do not know.
  -- 'Uncategorized' conflates "non-tech" with "no data"; dropping the no-data
  -- rows would drop the stealth companies — and every Form D company, whose
  -- industry is deliberately left NULL (see the header).
  AND (
        COALESCE(sec.name, classify_sector_parent(s.industry)) <> 'Uncategorized'
     OR s.industry IS NULL
     OR btrim(s.industry) = ''
  )
  -- Already-registered boards are not candidates.
  AND NOT EXISTS (
    SELECT 1 FROM sourcing_companies sc
     WHERE sc.startup_id = s.id
        OR (sc.inferred_name IS NOT NULL
            AND lower(btrim(sc.inferred_name)) = lower(btrim(s.name)))
  );

COMMENT ON VIEW board_discovery_candidates IS
  'Companies eligible for ATS board-slug discovery. Qualifies on a website OR a government filing — a Form D company has no website because it incorporated weeks ago, which makes it the highest-signal row here, not the weakest. slug_source says which rule admitted each row.';

GRANT SELECT ON board_discovery_candidates TO authenticated;
GRANT ALL    ON board_discovery_candidates TO service_role;
REVOKE ALL   ON board_discovery_candidates FROM anon;

-- ── 4. FOMO scoring: pts_inception ──────────────────────────────────────────
-- DROP then CREATE, not CREATE OR REPLACE: replace can only APPEND columns and
-- the new ones land mid-list. Same trap as every previous revision of this
-- view. A view holds no data, so dropping is free.
DROP VIEW IF EXISTS sourcing_fomo_scores;

CREATE VIEW sourcing_fomo_scores AS
WITH job_agg AS (
  SELECT
    company_id,
    count(*) FILTER (WHERE is_active)                          AS active_jobs,
    count(*)                                                   AS total_jobs,
    max(first_seen_at)                                         AS latest_job_seen,
    avg(EXTRACT(EPOCH FROM (closed_at - first_seen_at)) / 86400.0)
      FILTER (WHERE closed_at IS NOT NULL)                     AS avg_days_to_fill
  FROM early_job_postings
  GROUP BY company_id
),
sig_agg AS (
  SELECT
    p.company_id,
    count(*) FILTER (
      WHERE s.signal_type = 'seniority'
        AND s.signal_value IN ('Founding', 'Co-Founder', 'First Hire')
    )                                                          AS founding_signals,
    count(*) FILTER (
      WHERE s.signal_type = 'keyword'
        AND s.signal_value IN ('Stealth', 'Founding Team', 'Zero to One', 'Greenfield', 'Early Stage')
    )                                                          AS stealth_signals,
    count(DISTINCT s.signal_value) FILTER (
      WHERE s.signal_type = 'keyword'
        AND s.signal_value IN ('Sales Org', 'Customer Org', 'Finance Org', 'People Org',
                               'Compliance Org', 'Enterprise GTM', 'Territory Org', 'Partnerships Org')
    )                                                          AS scaled_org_functions,
    count(DISTINCT s.signal_value) FILTER (WHERE s.signal_type = 'tech_stack')
                                                               AS distinct_tech
  FROM job_signals s
  JOIN early_job_postings p ON p.id = s.job_id
  GROUP BY p.company_id
),
-- Earliest government filing per company. min(), not max(): a company that has
-- filed four times since 2019 is not an inception story regardless of how
-- recent the latest one is. The FIRST filing is the birth certificate.
gov_agg AS (
  SELECT
    startup_id,
    min(filing_date)  AS first_filing_date,
    max(filing_date)  AS latest_filing_date,
    count(*)          AS gov_filings
  FROM raw_gov_filings
  WHERE startup_id IS NOT NULL
  GROUP BY startup_id
),
scored AS (
  SELECT
    c.id                                     AS company_id,
    c.ats_provider,
    c.ats_board_token,
    c.inferred_name,
    c.startup_id,
    c.discovered_at,
    c.last_crawled_at,
    st.founded_year,
    (EXTRACT(YEAR FROM now())::int - st.founded_year)          AS company_age_years,
    gv.first_filing_date,
    gv.latest_filing_date,
    COALESCE(gv.gov_filings, 0)              AS gov_filings,
    COALESCE(j.active_jobs, 0)               AS active_jobs,
    COALESCE(j.total_jobs, 0)                AS total_jobs,
    j.latest_job_seen,
    round(j.avg_days_to_fill::numeric, 1)    AS avg_days_to_fill,
    COALESCE(g.founding_signals, 0)          AS founding_signals,
    COALESCE(g.stealth_signals, 0)           AS stealth_signals,
    COALESCE(g.scaled_org_functions, 0)      AS scaled_org_functions,
    COALESCE(g.distinct_tech, 0)             AS distinct_tech,

    LEAST(COALESCE(g.founding_signals, 0), 5) * 10             AS pts_founding,
    LEAST(COALESCE(g.stealth_signals, 0), 3) * 10              AS pts_stealth,
    CASE
      WHEN COALESCE(j.active_jobs, 0) = 0                THEN   0
      WHEN j.active_jobs BETWEEN 1  AND 10               THEN  20
      WHEN j.active_jobs BETWEEN 11 AND 25               THEN  10
      WHEN j.active_jobs BETWEEN 26 AND 50               THEN   0
      ELSE                                                    -30
    END                                                        AS pts_size,
    CASE
      WHEN j.latest_job_seen >= now() - interval '30 days' THEN 10
      WHEN j.latest_job_seen >= now() - interval '90 days' THEN  5
      ELSE                                                       0
    END                                                        AS pts_recency,
    CASE
      WHEN j.avg_days_to_fill IS NULL      THEN 0
      WHEN j.avg_days_to_fill <= 21        THEN 10
      WHEN j.avg_days_to_fill <= 45        THEN  5
      ELSE                                       0
    END                                                        AS pts_velocity,
    CASE
      WHEN COALESCE(g.scaled_org_functions, 0) >= 4 THEN -30
      WHEN     g.scaled_org_functions          =  3 THEN -20
      WHEN     g.scaled_org_functions          =  2 THEN -10
      ELSE                                                0
    END                                                        AS pts_scaled_org,
    CASE
      WHEN st.founded_year IS NULL                                   THEN   0
      WHEN EXTRACT(YEAR FROM now())::int - st.founded_year <= 2      THEN  20
      WHEN EXTRACT(YEAR FROM now())::int - st.founded_year <= 4      THEN  10
      WHEN EXTRACT(YEAR FROM now())::int - st.founded_year <= 7      THEN   0
      ELSE                                                                -10
    END                                                        AS pts_age,
    -- Inception. A first-ever Form D means a company that had no reason to
    -- exist on any public register until it raised money — the single
    -- earliest moment this pipeline can observe a company at all.
    --
    -- Never a penalty when absent. Only US issuers filing an exempt offering
    -- appear here at all; a company scoring 0 may simply be foreign, bootstrapped
    -- or funded through a route Form D does not cover. Absence of a filing is
    -- absence of evidence, and 32 of 34 current boards have none.
    CASE
      WHEN gv.first_filing_date IS NULL                              THEN   0
      WHEN gv.first_filing_date >= current_date - INTERVAL '180 days' THEN  25
      WHEN gv.first_filing_date >= current_date - INTERVAL '365 days' THEN  15
      WHEN gv.first_filing_date >= current_date - INTERVAL '730 days' THEN   5
      ELSE                                                                   0
    END                                                        AS pts_inception
  FROM sourcing_companies c
  LEFT JOIN job_agg  j  ON j.company_id  = c.id
  LEFT JOIN sig_agg  g  ON g.company_id  = c.id
  LEFT JOIN startups st ON st.id         = c.startup_id
  LEFT JOIN gov_agg  gv ON gv.startup_id = c.startup_id
)
SELECT
  scored.*,
  GREATEST(0, LEAST(100,
    pts_founding + pts_stealth + pts_size + pts_recency
    + pts_velocity + pts_scaled_org + pts_age + pts_inception
  )) AS fomo_score
FROM scored;

COMMENT ON VIEW sourcing_fomo_scores IS
  'Per-company FOMO ranking. Every pts_* component is exposed beside fomo_score so a rank can be explained. Positive: founding/stealth signals, small board, recent activity, fast fills, young company, recent first government filing. Negative: large board and distinct scaled corporate/GTM functions. Unknown founding year and absent filings both score 0, never a penalty — absence of evidence is not evidence of maturity.';

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
