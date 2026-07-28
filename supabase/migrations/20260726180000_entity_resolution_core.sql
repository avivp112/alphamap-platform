-- =============================================================================
-- Migration: entity resolution — the identifier substrate
-- Created:   2026-07-26
-- Description:
--   Five ingesters write into five piles that describe the same companies, and
--   the only thing joining them today is exact name equality. This is the layer
--   that turns those piles into one picture.
--
-- ── THE CORE MOVE: STOP MATCHING NAMES, START COLLECTING IDENTIFIERS ────────
--   Name matching is a computation you repeat forever and get wrong at the
--   margins. An identifier is an ASSET: once we know a company's registrable
--   domain, every future record carrying that domain resolves instantly and
--   deterministically, with no scoring and no review.
--
--   company_identifiers.UNIQUE (kind, value) is the whole engine. One domain
--   belongs to one company; one CIK belongs to one company. The constraint is
--   not bookkeeping, it is the matching rule expressed as schema.
--
--   And the constraint doubles as a DUPLICATE DETECTOR. If two startups rows
--   claim the same domain, one of them is wrong — that collision is exactly the
--   merge candidate we are looking for, surfaced for free by trying to insert.
--
-- ── PRECISION OVER RECALL, WHICH INVERTS THE REST OF THIS PIPELINE ──────────
--   Everywhere else here I argued for failing OPEN: a false exclusion is
--   invisible and permanent while a false inclusion costs one wasted request.
--   The candidate view, the archetype filter and the sector escape hatch all
--   follow that.
--
--   Resolution inverts it. A wrong link attributes another company's patents,
--   funding and hiring to a dossier an investor then acts on. It is invisible,
--   it is self-reinforcing (a wrongly-merged row looks BETTER substantiated
--   than a correct one), and it destroys the credibility that is the entire
--   product. A missed link costs a thinner dossier and nothing else.
--
--   So: Tier 1 and 2 auto-link only on evidence that cannot be coincidence.
--   Everything else goes to a human. Nothing fuzzy ever links itself.
--
-- Rollback: supabase/rollback/20260726180000_entity_resolution_core_down.sql
--
-- Idempotent.
-- =============================================================================

-- Trigram similarity for the fuzzy tier. Not previously installed — this is a
-- new dependency, and the only one this layer adds.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Normalisation ───────────────────────────────────────────────────────────

/**
 * Canonical company-name form: lowercase, no punctuation, no legal suffix.
 *
 * Distinct from gov_company_slug(), which produces a HYPHENATED slug for
 * probing ATS boards. This produces space-separated tokens, which is what
 * trigram similarity wants — "acme-robotics" and "acme robotics" score very
 * differently under similarity(), and mixing the two forms would quietly
 * degrade every fuzzy comparison.
 *
 * Suffix stripping runs twice for stacked forms ("ACME HOLDINGS, LLC.").
 */
CREATE OR REPLACE FUNCTION normalize_company_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH base AS (
    SELECT lower(btrim(coalesce(p_name, ''))) AS n
  ), amp AS (
    SELECT replace(n, '&', ' and ') AS n FROM base
  ), s1 AS (
    SELECT regexp_replace(n,
      '[[:space:],\.]+(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|plc|pbc|gmbh|ag|s\.a|n\.v|b\.v|pty|oy|ab|as|sas|srl|pte|kk|kg)\.?$',
      '') AS n FROM amp
  ), s2 AS (
    SELECT regexp_replace(n,
      '[[:space:],\.]+(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|plc|pbc|gmbh|ag|s\.a|n\.v|b\.v|pty|oy|ab|as|sas|srl|pte|kk|kg)\.?$',
      '') AS n FROM s1
  ), clean AS (
    SELECT btrim(regexp_replace(regexp_replace(n, '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')) AS n
    FROM s2
  )
  SELECT nullif(n, '') FROM clean;
$$;

COMMENT ON FUNCTION normalize_company_name(text) IS
  'Company name -> lowercase space-separated tokens with legal suffixes removed. Space-separated rather than hyphenated on purpose: trigram similarity scores the two forms very differently, so the fuzzy tier must compare like with like.';

/**
 * Registrable domain (eTLD+1) from any URL or bare host.
 *
 * "https://www.Acme-AI.co.uk/careers?x=1" -> "acme-ai.co.uk"
 *
 * The multi-part suffix list is not exhaustive — a complete public-suffix list
 * is thousands of entries and does not belong hard-coded in a migration. These
 * are the ones that actually appear in startup domains; anything else falls
 * back to last-two-labels, which is correct for the overwhelming majority.
 */
CREATE OR REPLACE FUNCTION registrable_domain(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h text;
  parts text[];
  n int;
  multi text[] := ARRAY['co.uk','com.au','co.nz','co.il','com.br','co.jp','co.za','org.uk','ac.uk','com.sg','co.in','com.mx'];
  m text;
BEGIN
  h := lower(btrim(coalesce(p_url, '')));
  IF h = '' THEN RETURN NULL; END IF;
  h := regexp_replace(h, '^[a-z][a-z0-9+.-]*://', '');   -- scheme
  h := split_part(h, '/', 1);                            -- path
  h := split_part(h, '?', 1);
  h := split_part(h, '#', 1);
  h := split_part(h, '@', 2 - (CASE WHEN position('@' in h) > 0 THEN 0 ELSE 1 END)); -- userinfo
  h := split_part(h, ':', 1);                            -- port
  h := regexp_replace(h, '^www\.', '');
  h := regexp_replace(h, '\.+$', '');
  IF h = '' OR position('.' in h) = 0 THEN RETURN NULL; END IF;

  FOREACH m IN ARRAY multi LOOP
    IF h LIKE '%.' || m THEN
      parts := string_to_array(h, '.');
      n := array_length(parts, 1);
      -- label + the two suffix labels
      IF n >= 3 THEN RETURN array_to_string(parts[n-2:n], '.'); END IF;
      RETURN h;
    END IF;
  END LOOP;

  parts := string_to_array(h, '.');
  n := array_length(parts, 1);
  IF n <= 2 THEN RETURN h; END IF;
  RETURN array_to_string(parts[n-1:n], '.');
END;
$$;

COMMENT ON FUNCTION registrable_domain(text) IS
  'URL or host -> eTLD+1. The strongest identifier available for a company: two records sharing a registrable domain are the same company, with no scoring required.';

-- ── Identifiers ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_identifiers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id   uuid        NOT NULL REFERENCES startups (id) ON DELETE CASCADE,

  -- What kind of identifier. Constrained rather than free text so a typo in one
  -- resolver cannot create a namespace nothing else ever looks in.
  kind         text        NOT NULL CHECK (kind IN (
                             'domain',        -- registrable domain, the strongest
                             'cik',           -- SEC Central Index Key
                             'ch_number',     -- Companies House company number
                             'github_org',    -- GitHub owner login
                             'hf_org',        -- Hugging Face namespace
                             'ats_token',     -- greenhouse/lever/ashby/workable board slug
                             'name_norm')),   -- normalised name, WEAK — never sufficient alone

  value        text        NOT NULL CHECK (btrim(value) <> ''),

  -- Where the claim came from, so a bad backfill can be undone by source.
  source       text        NOT NULL,

  -- 1.0 = the source states it directly (a CIK on a filing). Lower where the
  -- identifier was derived (a domain parsed from a repo homepage).
  confidence   numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (confidence > 0 AND confidence <= 1),

  first_seen_at timestamptz NOT NULL DEFAULT now(),

  -- THE ENGINE. One domain, one CIK, one GitHub org belongs to exactly one
  -- company. Violating this is not an error to be swallowed — it means two
  -- startups rows are the same company, which is precisely what we want to
  -- find. The resolver treats the collision as a merge candidate.
  --
  -- name_norm is exempt: names genuinely collide between unrelated companies,
  -- which is why it is marked weak and never auto-links on its own.
  CONSTRAINT company_identifiers_unique_strong UNIQUE (kind, value)
);

COMMENT ON TABLE company_identifiers IS
  'Strong keys per company, accumulated over time. UNIQUE (kind, value) is the matching rule expressed as schema: once a domain or CIK is known, every future record carrying it resolves deterministically. A uniqueness collision is not a failure — it is a duplicate-company detection.';
COMMENT ON COLUMN company_identifiers.kind IS
  'name_norm is deliberately WEAK and present only for blocking/lookup. It must never auto-link on its own — unrelated companies share names, and that assumption is the bug this whole layer exists to fix.';

CREATE INDEX IF NOT EXISTS idx_company_identifiers_startup ON company_identifiers (startup_id);
CREATE INDEX IF NOT EXISTS idx_company_identifiers_kind_value ON company_identifiers (kind, value);

-- Trigram index over normalised names: the blocking mechanism for the fuzzy
-- tier. Without it, Tier 3 is a cross join over the whole corpus.
CREATE INDEX IF NOT EXISTS idx_startups_name_norm_trgm
  ON startups USING gin (normalize_company_name(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_startups_domain
  ON startups (registrable_domain(website))
  WHERE website IS NOT NULL;

-- ── Match candidates ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_match_candidates (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What is being matched to a company. 'startup' means a suspected duplicate
  -- WITHIN startups — the case that matters most given canonical accuracy.
  left_kind      text        NOT NULL CHECK (left_kind IN
                               ('startup', 'gov_filing', 'oss_project', 'sourcing_company')),
  left_id        uuid        NOT NULL,
  right_startup_id uuid      NOT NULL REFERENCES startups (id) ON DELETE CASCADE,

  tier           smallint    NOT NULL CHECK (tier BETWEEN 1 AND 3),
  score          numeric(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),

  -- WHY. Every proposal carries its reasoning: which identifiers agreed, which
  -- attributes corroborated, what the similarity was. A link nobody can explain
  -- is a link nobody can audit, and this table is the audit trail.
  evidence       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'auto_linked', 'confirmed', 'rejected')),
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- One open proposal per pair. Re-running the resolver must not fill the
  -- review queue with the same suggestion a hundred times.
  CONSTRAINT entity_match_candidates_unique_pair UNIQUE (left_kind, left_id, right_startup_id),
  CONSTRAINT entity_match_no_self CHECK (NOT (left_kind = 'startup' AND left_id = right_startup_id))
);

COMMENT ON TABLE entity_match_candidates IS
  'Proposed links, with the evidence that produced them. Tier 1-2 land here as auto_linked (recorded for audit, not for review); tier 3 lands as pending and requires a human. Unique per pair so re-running the resolver never re-queues a decision already made.';

CREATE INDEX IF NOT EXISTS idx_match_candidates_pending
  ON entity_match_candidates (score DESC, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_match_candidates_right ON entity_match_candidates (right_startup_id);

-- ── Merge audit ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_merges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  surviving_id    uuid        NOT NULL REFERENCES startups (id) ON DELETE CASCADE,

  -- NOT a foreign key: the merged row is deleted by the merge itself, so an FK
  -- would either block the delete or cascade this record away — destroying the
  -- audit trail at the exact moment it becomes the only record of what happened.
  merged_id       uuid        NOT NULL,

  -- The complete pre-merge row, so the merge is reversible. This is the entire
  -- reason a physical merge is acceptable rather than reckless.
  merged_snapshot jsonb       NOT NULL,

  -- Which columns were actually filled from the merged row, and which were
  -- deliberately left alone because the survivor already had a value.
  filled_columns  text[]      NOT NULL DEFAULT '{}',
  skipped_columns text[]      NOT NULL DEFAULT '{}',
  -- Which tables had rows repointed, and how many.
  repointed       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  evidence        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  merged_by       text,
  merged_at       timestamptz NOT NULL DEFAULT now(),
  reversed_at     timestamptz
);

COMMENT ON TABLE company_merges IS
  'One row per physical merge, holding the complete pre-merge snapshot so it can be undone. merged_id is deliberately NOT a foreign key — the row it points at no longer exists, and an FK would cascade away the audit trail at the moment it matters most.';

CREATE INDEX IF NOT EXISTS idx_company_merges_surviving ON company_merges (surviving_id);
CREATE INDEX IF NOT EXISTS idx_company_merges_active ON company_merges (merged_at DESC) WHERE reversed_at IS NULL;

-- ── Grants ──────────────────────────────────────────────────────────────────

ALTER TABLE company_identifiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_merges          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_identifiers_read ON company_identifiers;
CREATE POLICY company_identifiers_read ON company_identifiers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS company_identifiers_service ON company_identifiers;
CREATE POLICY company_identifiers_service ON company_identifiers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The review queue is worked by a human through the app, so authenticated users
-- need to be able to update status.
DROP POLICY IF EXISTS match_candidates_read ON entity_match_candidates;
CREATE POLICY match_candidates_read ON entity_match_candidates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS match_candidates_decide ON entity_match_candidates;
CREATE POLICY match_candidates_decide ON entity_match_candidates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS match_candidates_service ON entity_match_candidates;
CREATE POLICY match_candidates_service ON entity_match_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS company_merges_read ON company_merges;
CREATE POLICY company_merges_read ON company_merges FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS company_merges_service ON company_merges;
CREATE POLICY company_merges_service ON company_merges FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON company_identifiers, entity_match_candidates, company_merges TO authenticated;
GRANT UPDATE (status, decided_by, decided_at) ON entity_match_candidates TO authenticated;
GRANT ALL ON company_identifiers, entity_match_candidates, company_merges TO service_role;
REVOKE ALL ON company_identifiers, entity_match_candidates, company_merges FROM anon;

-- ── Backfill from what we already hold ───────────────────────────────────────
-- Every identifier below already exists somewhere in the database; none of it
-- requires a network call. This is pure accumulated value being made usable.

-- 1. Domains from startups.website. ON CONFLICT DO NOTHING: a collision means
--    two startups rows share a domain, which the resolver picks up separately
--    as a duplicate candidate rather than an error here.
INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
SELECT s.id, 'domain', registrable_domain(s.website), 'startups.website', 1.00
  FROM startups s
 WHERE s.website IS NOT NULL
   AND registrable_domain(s.website) IS NOT NULL
ON CONFLICT (kind, value) DO NOTHING;

-- 2. CIK and Companies House numbers from government filings. Both are
--    permanent per-entity registry keys — the strongest identifiers we will
--    ever hold for a company, stronger even than a domain (domains change).
INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
SELECT DISTINCT ON (f.cik) f.startup_id, 'cik', btrim(f.cik), 'raw_gov_filings.cik', 1.00
  FROM raw_gov_filings f
 WHERE f.startup_id IS NOT NULL AND f.cik IS NOT NULL AND btrim(f.cik) <> ''
 ORDER BY f.cik, f.filing_date
ON CONFLICT (kind, value) DO NOTHING;

INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
SELECT DISTINCT ON (f.entity_number) f.startup_id, 'ch_number', btrim(f.entity_number),
       'raw_gov_filings.entity_number', 1.00
  FROM raw_gov_filings f
 WHERE f.startup_id IS NOT NULL
   AND f.source = 'uk_companies_house'
   AND f.entity_number IS NOT NULL AND btrim(f.entity_number) <> ''
 ORDER BY f.entity_number, f.filing_date
ON CONFLICT (kind, value) DO NOTHING;

-- 3. ATS board tokens. These links are correct BY CONSTRUCTION — discover-boards
--    starts from a startups row and probes outward, so the association was never
--    a guess.
INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
SELECT DISTINCT ON (c.ats_board_token) c.startup_id, 'ats_token', c.ats_board_token,
       'sourcing_companies', 1.00
  FROM sourcing_companies c
 WHERE c.startup_id IS NOT NULL AND c.ats_board_token IS NOT NULL
 ORDER BY c.ats_board_token, c.discovered_at
ON CONFLICT (kind, value) DO NOTHING;

-- 4. Normalised names for every company. Weak by design — this exists for
--    blocking and lookup, never for linking on its own.
INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
SELECT DISTINCT ON (normalize_company_name(s.name)) s.id, 'name_norm',
       normalize_company_name(s.name), 'startups.name', 0.30
  FROM startups s
 WHERE normalize_company_name(s.name) IS NOT NULL
 ORDER BY normalize_company_name(s.name), s.created_at
ON CONFLICT (kind, value) DO NOTHING;
