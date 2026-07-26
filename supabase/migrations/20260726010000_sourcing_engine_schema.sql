-- =============================================================================
-- Migration: FOMO & Sourcing Engine — core schema
-- Created:   2026-07-26
-- Description:
--   Backing tables for the sourcing pipeline that discovers pre-launch and
--   stealth startups from public ATS job boards (Greenhouse, Lever) before
--   they have a funding record or, often, a real website.
--
--   Three tables, one per level of the pipeline:
--
--     sourcing_companies  — one row per company board we have ever seen, keyed
--                           by (ats_provider, ats_board_token). This is the
--                           idempotency anchor: re-crawling a board must never
--                           create a second company.
--     early_job_postings  — one row per job, keyed by (company_id,
--                           external_job_id). Carries the lifecycle: a posting
--                           is inserted once with first_seen_at, and when a
--                           later crawl no longer finds it we flip is_active
--                           false and stamp closed_at. The gap between those
--                           two timestamps IS the time-to-fill signal.
--     job_signals         — extracted, categorised facts about a posting
--                           ('seniority'/'Founding', 'tech_stack'/'Rust',
--                           'keyword'/'Stealth'), keyed by
--                           (job_id, signal_type, signal_value) so re-parsing
--                           the same posting is idempotent too.
--
--   Every write path is expected to use ON CONFLICT ... DO UPDATE/NOTHING
--   against the unique constraints above, so the crawler can be re-run at any
--   cadence without producing duplicates.
--
-- Access model:
--   Proprietary data. Authenticated users get read-only; the crawler writes
--   with the service-role key. `anon` gets nothing — this is the IP, so it is
--   deliberately NOT world-readable the way `public_companies` is.
--
-- Rollback: supabase/rollback/20260726010000_sourcing_engine_schema_down.sql
--   (kept outside migrations/ so the CLI never applies it as a migration).
--
-- Idempotent; safe to run more than once.
-- =============================================================================

-- ── 1. sourcing_companies ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sourcing_companies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which ATS the board lives on. CHECK keeps typos ('Greenhouse', 'lever ')
  -- from silently forking a company into two rows that the UNIQUE constraint
  -- below would then consider distinct.
  ats_provider    varchar(32) NOT NULL CHECK (ats_provider IN ('greenhouse', 'lever')),
  -- The company's slug on that ATS, e.g. the "acmeco" in
  -- boards.greenhouse.io/acmeco or jobs.lever.co/acmeco.
  ats_board_token varchar(255) NOT NULL,
  -- Best-effort startup name. Nullable on purpose: at discovery time we often
  -- have only the board token, and the name is filled in by later enrichment.
  inferred_name   varchar(255),
  discovered_at   timestamptz NOT NULL DEFAULT now(),

  -- Idempotency anchor for the crawler.
  CONSTRAINT sourcing_companies_provider_token_key UNIQUE (ats_provider, ats_board_token)
);

COMMENT ON TABLE  sourcing_companies IS 'One row per ATS job board discovered by the sourcing crawler. Unique on (ats_provider, ats_board_token).';
COMMENT ON COLUMN sourcing_companies.ats_board_token IS 'Company slug on the ATS, e.g. "acmeco" in boards.greenhouse.io/acmeco.';
COMMENT ON COLUMN sourcing_companies.inferred_name IS 'Best-effort company name; NULL until enrichment resolves it.';

-- Supports "what have we discovered lately", the primary FOMO feed ordering.
CREATE INDEX IF NOT EXISTS idx_sourcing_companies_discovered_at
  ON sourcing_companies (discovered_at DESC);

-- Case-insensitive name lookup for dedupe against the existing startups table.
CREATE INDEX IF NOT EXISTS idx_sourcing_companies_inferred_name_lower
  ON sourcing_companies (lower(inferred_name))
  WHERE inferred_name IS NOT NULL;

-- ── 2. early_job_postings ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS early_job_postings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL
                              REFERENCES sourcing_companies (id) ON DELETE CASCADE,
  -- The ATS's own job id. varchar rather than a number: Greenhouse uses
  -- numeric ids, Lever uses UUIDs.
  external_job_id varchar(255) NOT NULL,
  title           varchar(512) NOT NULL,
  url             varchar(1024) NOT NULL,
  -- Lifecycle. A posting starts active; when a crawl stops seeing it we set
  -- is_active = false AND closed_at = now(). Keeping both is deliberate:
  -- is_active answers "show me open roles" with an index-only scan, while
  -- closed_at carries the timestamp that time-to-fill is computed from.
  is_active       boolean     NOT NULL DEFAULT true,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,

  CONSTRAINT early_job_postings_company_external_key UNIQUE (company_id, external_job_id),
  -- A posting cannot close before it was first seen, and the two lifecycle
  -- fields must agree: closed_at set <=> is_active false.
  CONSTRAINT early_job_postings_closed_after_seen CHECK (closed_at IS NULL OR closed_at >= first_seen_at),
  CONSTRAINT early_job_postings_lifecycle_consistent CHECK (
    (is_active AND closed_at IS NULL) OR (NOT is_active AND closed_at IS NOT NULL)
  )
);

COMMENT ON TABLE  early_job_postings IS 'One row per job posting on a tracked ATS board. Unique on (company_id, external_job_id).';
COMMENT ON COLUMN early_job_postings.closed_at IS 'Set when a crawl no longer finds the posting. closed_at - first_seen_at is the time-to-fill signal.';
COMMENT ON COLUMN early_job_postings.is_active IS 'Denormalised from closed_at for cheap filtering; kept consistent by a CHECK constraint.';

CREATE INDEX IF NOT EXISTS idx_early_job_postings_company_id
  ON early_job_postings (company_id);

-- Open roles only — the hot path for the sourcing feed.
CREATE INDEX IF NOT EXISTS idx_early_job_postings_active
  ON early_job_postings (first_seen_at DESC)
  WHERE is_active;

-- Time-to-fill analytics scan closed postings only.
CREATE INDEX IF NOT EXISTS idx_early_job_postings_closed_at
  ON early_job_postings (closed_at DESC)
  WHERE closed_at IS NOT NULL;

-- ── 3. job_signals ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_signals (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid        NOT NULL
                           REFERENCES early_job_postings (id) ON DELETE CASCADE,
  -- Category of the extracted fact. CHECK keeps the vocabulary closed so
  -- downstream scoring can rely on it; extend deliberately in a migration
  -- rather than by writing a new string at runtime.
  signal_type  varchar(64) NOT NULL CHECK (signal_type IN ('seniority', 'tech_stack', 'keyword')),
  signal_value varchar(255) NOT NULL,

  CONSTRAINT job_signals_job_type_value_key UNIQUE (job_id, signal_type, signal_value)
);

COMMENT ON TABLE  job_signals IS 'Categorised facts extracted from a posting, e.g. seniority/Founding, tech_stack/Rust, keyword/Stealth.';

CREATE INDEX IF NOT EXISTS idx_job_signals_job_id
  ON job_signals (job_id);

-- "Find every company hiring a Founding Engineer" / "…writing Rust" — the core
-- sourcing query runs type+value first, then joins back up to the company.
CREATE INDEX IF NOT EXISTS idx_job_signals_type_value
  ON job_signals (signal_type, signal_value);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- NOTE on service_role: in Supabase the service-role key BYPASSES RLS
-- entirely, so the "_service_all" policies below are not what actually grants
-- the crawler access — the GRANTs are. They are declared anyway so the intended
-- access model is legible in the schema itself, and so the tables behave the
-- same way if RLS is ever forced (e.g. FORCE ROW LEVEL SECURITY).

ALTER TABLE sourcing_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_signals        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sourcing_companies_read_authenticated" ON sourcing_companies;
CREATE POLICY "sourcing_companies_read_authenticated"
  ON sourcing_companies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sourcing_companies_service_all" ON sourcing_companies;
CREATE POLICY "sourcing_companies_service_all"
  ON sourcing_companies FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "early_job_postings_read_authenticated" ON early_job_postings;
CREATE POLICY "early_job_postings_read_authenticated"
  ON early_job_postings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "early_job_postings_service_all" ON early_job_postings;
CREATE POLICY "early_job_postings_service_all"
  ON early_job_postings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "job_signals_read_authenticated" ON job_signals;
CREATE POLICY "job_signals_read_authenticated"
  ON job_signals FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "job_signals_service_all" ON job_signals;
CREATE POLICY "job_signals_service_all"
  ON job_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Proprietary data: authenticated reads, service_role writes, anon nothing.

GRANT SELECT ON sourcing_companies, early_job_postings, job_signals TO authenticated;
GRANT ALL    ON sourcing_companies, early_job_postings, job_signals TO service_role;
REVOKE ALL   ON sourcing_companies, early_job_postings, job_signals FROM anon;
