-- =============================================================================
-- Migration: startups_schema_expansion
-- Created:   2026-07-17
-- Description: Schema groundwork for the 2,500-company import, the recurring
--              enrichment pipeline, and cross-table analysis:
--
--   1. sectors                 — two-tier taxonomy table (seeded from the
--                                app's SECTOR_TAXONOMY) so sector becomes a
--                                stored, filterable fact instead of a keyword
--                                guess over free-text `industry`
--   2. startups (new columns)  — identity (linkedin_url, logo_url, slug),
--                                classification (sector FKs, status + exit
--                                fields, business_model, tags, state),
--                                pipeline ops (last_enriched_at,
--                                enrichment_confidence, is_manually_verified,
--                                data_sources), and a generated tsvector for
--                                real full-text search
--   3. people + startup_people — founders/executives as first-class rows,
--                                queryable across companies
--   4. funding_round_investors — real FK join between funding rounds and the
--                                investors table (today lead_investor /
--                                investors are plain text on funding_rounds)
--   5. startup_changes         — field-level audit log: history + the review
--                                trail for automated corrections
--   6. startups_search rebuild — the view's `s.*` was frozen at creation, so
--                                it must be dropped/recreated to expose the
--                                new columns; while here, sector_parent now
--                                prefers the stored sector over the keyword
--                                classifier (falls back when sector_id NULL)
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT / DROP ... IF EXISTS throughout.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- Frontend impact: none required — the app selects named fields or *, and
-- all new columns are additive.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) sectors — two-tier taxonomy (parent rows have parent_id NULL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sectors (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE CHECK (trim(name) <> ''),
  parent_id  uuid        REFERENCES sectors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sectors IS
  'Two-tier sector taxonomy (parent rows have parent_id NULL). Mirrors the app''s SECTOR_TAXONOMY; startups reference it via sector_id / sub_sector_id.';

CREATE INDEX IF NOT EXISTS idx_sectors_parent ON sectors(parent_id);

ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sectors_public_read" ON sectors;
CREATE POLICY "sectors_public_read" ON sectors FOR SELECT USING (true);
DROP POLICY IF EXISTS "sectors_service_write" ON sectors;
CREATE POLICY "sectors_service_write" ON sectors FOR ALL USING (auth.role() = 'service_role');

-- Seed: parents
INSERT INTO sectors (name) VALUES
  ('AI & ML'),
  ('Fintech'),
  ('Cybersecurity'),
  ('SaaS & Dev Tools'),
  ('E-commerce & Retail'),
  ('Health & Life Sciences'),
  ('Climate & Energy'),
  ('Enterprise Software'),
  ('Consumer & Media'),
  ('DeepTech'),
  ('Uncategorized')
ON CONFLICT (name) DO NOTHING;

-- Seed: sub-sectors (name is globally unique across the taxonomy)
INSERT INTO sectors (name, parent_id)
SELECT v.sub_name, p.id
FROM (VALUES
  ('AI & ML',                'AI / General'),
  ('AI & ML',                'LLMs'),
  ('AI & ML',                'Generative AI'),
  ('AI & ML',                'Computer Vision'),
  ('AI & ML',                'NLP / Speech'),
  ('AI & ML',                'AI Agents'),
  ('AI & ML',                'MLOps'),
  ('AI & ML',                'AI Infrastructure'),
  ('Fintech',                'Fintech / General'),
  ('Fintech',                'Payments'),
  ('Fintech',                'Banking / Neobanking'),
  ('Fintech',                'Insurance / Insurtech'),
  ('Fintech',                'Lending'),
  ('Fintech',                'Crypto / Web3'),
  ('Fintech',                'WealthTech'),
  ('Fintech',                'RegTech'),
  ('Cybersecurity',          'Cybersecurity / General'),
  ('Cybersecurity',          'Identity & Access'),
  ('Cybersecurity',          'Endpoint Security'),
  ('Cybersecurity',          'Cloud Security'),
  ('Cybersecurity',          'Threat Intelligence'),
  ('Cybersecurity',          'Zero Trust'),
  ('Cybersecurity',          'Data Security'),
  ('SaaS & Dev Tools',       'SaaS / General'),
  ('SaaS & Dev Tools',       'Developer Tools'),
  ('SaaS & Dev Tools',       'DevOps / CI-CD'),
  ('SaaS & Dev Tools',       'API Platforms'),
  ('SaaS & Dev Tools',       'Low-Code / No-Code'),
  ('SaaS & Dev Tools',       'Data Infrastructure'),
  ('E-commerce & Retail',    'E-commerce / General'),
  ('E-commerce & Retail',    'D2C'),
  ('E-commerce & Retail',    'Marketplaces'),
  ('E-commerce & Retail',    'Logistics / Supply Chain'),
  ('E-commerce & Retail',    'Retail Tech'),
  ('Health & Life Sciences', 'Digital Health'),
  ('Health & Life Sciences', 'MedTech'),
  ('Health & Life Sciences', 'Biotech / Genomics'),
  ('Health & Life Sciences', 'Mental Health'),
  ('Health & Life Sciences', 'Healthcare SaaS'),
  ('Climate & Energy',       'CleanTech'),
  ('Climate & Energy',       'EnergyTech'),
  ('Climate & Energy',       'Carbon Markets'),
  ('Climate & Energy',       'Sustainability'),
  ('Enterprise Software',    'Enterprise / General'),
  ('Enterprise Software',    'CRM'),
  ('Enterprise Software',    'HR Tech'),
  ('Enterprise Software',    'ERP / Finance'),
  ('Enterprise Software',    'Analytics / BI'),
  ('Consumer & Media',       'Consumer / General'),
  ('Consumer & Media',       'Social Media'),
  ('Consumer & Media',       'Gaming'),
  ('Consumer & Media',       'EdTech'),
  ('Consumer & Media',       'Travel & Hospitality'),
  ('Consumer & Media',       'Media / Content'),
  ('DeepTech',               'DeepTech / General'),
  ('DeepTech',               'Quantum Computing'),
  ('DeepTech',               'Robotics'),
  ('DeepTech',               'Space Tech'),
  ('DeepTech',               'Semiconductors')
) AS v(parent_name, sub_name)
JOIN sectors p ON p.name = v.parent_name AND p.parent_id IS NULL
ON CONFLICT (name) DO NOTHING;

-- Import helper: resolve a sector/sub-sector name to its id
CREATE OR REPLACE FUNCTION sector_id_by_name(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM sectors WHERE lower(name) = lower(trim(p_name)) LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 2) startups — new columns
-- -----------------------------------------------------------------------------

-- Live-schema guard: the live database may already have sector_id /
-- sub_sector_id columns created earlier as TEXT. ADD COLUMN IF NOT EXISTS
-- silently keeps such a column, and the view rebuild below then fails on
-- "operator does not exist: uuid = text" when joining sectors.id against it.
-- Rename any non-uuid version aside; the proper uuid columns are added below
-- and any salvageable legacy values are migrated right after.
DO $do$
DECLARE
  v_col  text;
  v_type text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['sector_id', 'sub_sector_id'] LOOP
    SELECT data_type INTO v_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'startups' AND column_name = v_col;

    IF v_type IS NOT NULL AND v_type <> 'uuid' THEN
      EXECUTE format('ALTER TABLE startups RENAME COLUMN %I TO %I', v_col, v_col || '_legacy_text');
      RAISE NOTICE 'startups.% was type % (not uuid) — renamed to %_legacy_text; values migrated below',
        v_col, v_type, v_col;
    END IF;
  END LOOP;
END
$do$;

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS linkedin_url          text,
  ADD COLUMN IF NOT EXISTS logo_url              text,
  ADD COLUMN IF NOT EXISTS slug                  text,
  ADD COLUMN IF NOT EXISTS sector_id             uuid REFERENCES sectors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_sector_id         uuid REFERENCES sectors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status                text NOT NULL DEFAULT 'active'
                                                 CHECK (status IN ('active', 'acquired', 'ipo', 'closed')),
  ADD COLUMN IF NOT EXISTS acquired_by           text,
  ADD COLUMN IF NOT EXISTS exit_date             date,
  ADD COLUMN IF NOT EXISTS exit_value            numeric CHECK (exit_value >= 0),
  ADD COLUMN IF NOT EXISTS ticker                text,
  ADD COLUMN IF NOT EXISTS business_model        text CHECK (business_model IN ('B2B', 'B2C', 'B2B2C')),
  ADD COLUMN IF NOT EXISTS tags                  text[],
  ADD COLUMN IF NOT EXISTS state_province        text,
  ADD COLUMN IF NOT EXISTS country_code          char(2),
  ADD COLUMN IF NOT EXISTS last_enriched_at      timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_confidence integer CHECK (enrichment_confidence BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS is_manually_verified  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_sources          jsonb;

-- Migrate values from any legacy text column renamed aside above: first match
-- sector NAMES against the taxonomy, then literal uuid strings that point at
-- a real sectors row. The legacy column is dropped only once every non-null
-- value has been mapped; otherwise it is kept (as *_legacy_text) for manual
-- review, and this block will finish the cleanup on a later re-run.
DO $do$
DECLARE
  v_target     text;
  v_legacy     text;
  v_all_mapped boolean;
BEGIN
  FOR v_target, v_legacy IN
    VALUES ('sector_id',     'sector_id_legacy_text'),
           ('sub_sector_id', 'sub_sector_id_legacy_text')
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'startups' AND column_name = v_legacy
    ) THEN
      EXECUTE format(
        'UPDATE startups s SET %1$I = sec.id FROM sectors sec
          WHERE s.%1$I IS NULL AND s.%2$I IS NOT NULL
            AND lower(sec.name) = lower(trim(s.%2$I))',
        v_target, v_legacy);

      EXECUTE format(
        'UPDATE startups s SET %1$I = s.%2$I::uuid
          WHERE s.%1$I IS NULL
            AND s.%2$I ~* ''^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$''
            AND EXISTS (SELECT 1 FROM sectors x WHERE x.id = s.%2$I::uuid)',
        v_target, v_legacy);

      EXECUTE format(
        'SELECT NOT EXISTS (SELECT 1 FROM startups WHERE %2$I IS NOT NULL AND %1$I IS NULL)',
        v_target, v_legacy)
      INTO v_all_mapped;

      IF v_all_mapped THEN
        EXECUTE format('ALTER TABLE startups DROP COLUMN %I', v_legacy);
      ELSE
        RAISE NOTICE 'startups.% kept — some values could not be mapped to the sectors taxonomy; review manually, then drop it', v_legacy;
      END IF;
    END IF;
  END LOOP;
END
$do$;

COMMENT ON COLUMN startups.linkedin_url          IS 'Company LinkedIn page URL — secondary dedup key after website.';
COMMENT ON COLUMN startups.status                IS 'active | acquired | ipo | closed. Exit details in acquired_by / exit_date / exit_value / ticker.';
COMMENT ON COLUMN startups.last_enriched_at      IS 'When the enrichment pipeline last researched this row (staleness ordering for the refresher).';
COMMENT ON COLUMN startups.is_manually_verified  IS 'Human-curated row: automated pipelines must never overwrite non-null fields.';
COMMENT ON COLUMN startups.data_sources          IS 'Provenance map, e.g. {"employee_count": "https://...", "founded_year": "https://..."}';

-- Full-text search: weighted tsvector (name > industry > description),
-- generated so it can never drift from the source columns.
ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple'::regconfig,  coalesce(name, '')),        'A') ||
      setweight(to_tsvector('english'::regconfig, coalesce(industry, '')),    'B') ||
      setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'C')
    ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_startups_slug     ON startups (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_startups_linkedin ON startups (lower(linkedin_url)) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_startups_status         ON startups (status);
CREATE INDEX IF NOT EXISTS idx_startups_sector         ON startups (sector_id);
CREATE INDEX IF NOT EXISTS idx_startups_sub_sector     ON startups (sub_sector_id);
CREATE INDEX IF NOT EXISTS idx_startups_state          ON startups (state_province);
CREATE INDEX IF NOT EXISTS idx_startups_last_enriched  ON startups (last_enriched_at ASC NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_startups_tags_gin       ON startups USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_startups_search_tsv     ON startups USING gin (search_tsv);

-- -----------------------------------------------------------------------------
-- 3) people + startup_people — founders/executives as queryable rows
--    (the jsonb founders/leadership columns stay for display; these tables are
--    what enables "companies founded by X" / serial-founder analysis)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text        NOT NULL CHECK (trim(full_name) <> ''),
  linkedin_url text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_people_linkedin ON people (lower(linkedin_url)) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_name ON people (lower(full_name));

DROP TRIGGER IF EXISTS trg_people_updated_at ON people;
CREATE TRIGGER trg_people_updated_at
  BEFORE UPDATE ON people
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS startup_people (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id uuid        NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  person_id  uuid        NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
  -- One row per person per company; a founder-CEO is a single row with
  -- role='CEO', is_founder=true.
  role       text,
  is_founder boolean     NOT NULL DEFAULT false,
  start_date date,
  end_date   date,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_startup_people UNIQUE (startup_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_startup_people_startup ON startup_people (startup_id);
CREATE INDEX IF NOT EXISTS idx_startup_people_person  ON startup_people (person_id);

-- -----------------------------------------------------------------------------
-- 4) funding_round_investors — real join between rounds and the investors
--    table. The plain-text lead_investor / investors columns on
--    funding_rounds remain as the raw fallback for names that don't (yet)
--    match a row in `investors`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funding_round_investors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    uuid        NOT NULL REFERENCES funding_rounds(id) ON DELETE CASCADE,
  investor_id uuid        NOT NULL REFERENCES investors(id)      ON DELETE CASCADE,
  is_lead     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_round_investor UNIQUE (round_id, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_fri_investor ON funding_round_investors (investor_id);

-- -----------------------------------------------------------------------------
-- 5) startup_changes — field-level audit log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_changes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id uuid        NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  field      text        NOT NULL,
  old_value  text,
  new_value  text,
  source     text        NOT NULL DEFAULT 'manual',  -- 'manual' | 'excel_import' | 'bulk_enrich' | 'weekly_refresh' | ...
  confidence integer     CHECK (confidence BETWEEN 0 AND 100),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_startup_changes_startup ON startup_changes (startup_id, changed_at DESC);

-- RLS for all new tables: public read, service_role write (existing pattern)
ALTER TABLE people                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE startup_people          ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_round_investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE startup_changes         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "people_public_read" ON people;
CREATE POLICY "people_public_read" ON people FOR SELECT USING (true);
DROP POLICY IF EXISTS "people_service_write" ON people;
CREATE POLICY "people_service_write" ON people FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "startup_people_public_read" ON startup_people;
CREATE POLICY "startup_people_public_read" ON startup_people FOR SELECT USING (true);
DROP POLICY IF EXISTS "startup_people_service_write" ON startup_people;
CREATE POLICY "startup_people_service_write" ON startup_people FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "fri_public_read" ON funding_round_investors;
CREATE POLICY "fri_public_read" ON funding_round_investors FOR SELECT USING (true);
DROP POLICY IF EXISTS "fri_service_write" ON funding_round_investors;
CREATE POLICY "fri_service_write" ON funding_round_investors FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "startup_changes_public_read" ON startup_changes;
CREATE POLICY "startup_changes_public_read" ON startup_changes FOR SELECT USING (true);
DROP POLICY IF EXISTS "startup_changes_service_write" ON startup_changes;
CREATE POLICY "startup_changes_service_write" ON startup_changes FOR ALL USING (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- 6) Rebuild startups_search
--    A view's `s.*` is expanded at creation time, so the existing view would
--    never expose the new columns. Dropped and recreated (the dependent
--    suggested_startup_peers function must be dropped first, then recreated).
--    Improvement while here: sector_parent now prefers the STORED sector
--    (sectors.name via sector_id) and only falls back to the keyword
--    classifier when sector_id is NULL — so imported/curated sectors
--    immediately drive filtering and peer grouping.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS suggested_startup_peers(uuid, uuid[], int);
DROP VIEW IF EXISTS startups_search;

CREATE VIEW startups_search AS
SELECT
  s.*,
  COALESCE(sec.name, classify_sector_parent(s.industry)) AS sector_parent,
  sub_sec.name                       AS sub_sector_name,
  stage_group(latest.round_type)     AS stage_group_val,
  latest.round_type                  AS latest_round_type,
  latest.valuation                   AS latest_valuation,
  latest.announcement_date           AS latest_round_date,
  latest.is_valuation_estimated      AS latest_round_is_estimated,
  COALESCE(totals.total_raised, 0)   AS total_raised,
  (latest.announcement_date IS NOT NULL
    AND latest.announcement_date >= (CURRENT_DATE - INTERVAL '6 months')) AS has_recent_round,
  COUNT(*) OVER (
    PARTITION BY COALESCE(sec.name, classify_sector_parent(s.industry)),
                 stage_group(latest.round_type)
  ) AS peer_count,
  (COALESCE(sec.name, classify_sector_parent(s.industry)) <> 'Uncategorized'
    AND stage_group(latest.round_type) <> 'unknown') AS peer_count_valid
FROM startups s
LEFT JOIN sectors sec     ON sec.id     = s.sector_id
LEFT JOIN sectors sub_sec ON sub_sec.id = s.sub_sector_id
LEFT JOIN LATERAL (
  SELECT fr.round_type, fr.valuation, fr.announcement_date, fr.is_valuation_estimated
  FROM funding_rounds fr
  WHERE fr.startup_id = s.id
  ORDER BY fr.announcement_date DESC NULLS LAST, fr.created_at DESC
  LIMIT 1
) latest ON true
LEFT JOIN LATERAL (
  SELECT SUM(fr.amount_raised) AS total_raised
  FROM funding_rounds fr
  WHERE fr.startup_id = s.id
) totals ON true;

COMMENT ON VIEW startups_search IS
  'Read-optimized view for the Startups Hub: precomputes latest round, total raised, sector bucket (stored sector first, keyword fallback), and peer_count. Recreated by 20260717000000 to expose the schema-expansion columns.';

CREATE OR REPLACE FUNCTION suggested_startup_peers(
  p_startup_id  uuid,
  p_exclude_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_limit       int DEFAULT 5
)
RETURNS SETOF startups_search
LANGUAGE sql
STABLE
AS $$
  SELECT peer.*
  FROM startups_search target
  JOIN startups_search peer
    ON peer.sector_parent    = target.sector_parent
   AND peer.stage_group_val  = target.stage_group_val
   AND target.peer_count_valid
   AND peer.id <> target.id
   AND peer.id <> ALL (p_exclude_ids)
  WHERE target.id = p_startup_id
  ORDER BY peer.total_raised DESC NULLS LAST
  LIMIT p_limit;
$$;
