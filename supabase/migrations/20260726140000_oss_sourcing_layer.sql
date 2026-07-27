-- =============================================================================
-- Migration: open-source / developer-community sourcing (Layer 2)
-- Created:   2026-07-26
-- Description:
--   The layer BEFORE registration. A government filing means a company exists;
--   an ATS board means it is hiring. A GitHub repo or a Hugging Face model can
--   appear months before either, made by people who have not incorporated yet.
--
--   Two tables and a view:
--     oss_projects        — one row per tracked repo/model/space/dataset
--     oss_project_metrics — a TIME SERIES of counters per project
--     oss_project_velocity— growth rates derived from that series
--     oss_excluded_owners — the big-tech denylist, as data not code
--
-- ── VELOCITY NEEDS TWO OBSERVATIONS. THIS IS THE WHOLE DESIGN. ──────────────
--   "Star velocity over 24h/7d" cannot be computed from a crawl. A crawl
--   returns a LEVEL — 1,200 stars — and a level is not a rate. Two thousand
--   stars accumulated over three years and two thousand accumulated last
--   Tuesday are the same number and completely different companies.
--
--   GitHub and Hugging Face both return only the current count; neither exposes
--   history. So the counters go in an append-only table and velocity is a
--   DIFFERENCE between rows. The consequence to be clear about up front: the
--   FIRST run of either ingester produces NULL velocity for everything. It is
--   establishing a baseline, not failing. Rates appear on the second run, and
--   7-day rates a week in.
--
--   This is why metrics are separate from projects rather than columns on it.
--   Overwriting star_count in place would destroy the only thing that makes
--   this layer worth having.
--
-- ── ON EXCLUDING BIG TECH ───────────────────────────────────────────────────
--   A denylist table rather than a constant in the function: it needs tuning
--   constantly as new corporate orgs appear, and a redeploy per name is a tax
--   nobody will pay, so the list would rot. Seeded with the obvious offenders;
--   add rows freely.
--
--   Note what it is NOT: a quality filter. It removes organisations that cannot
--   be startups. A 40,000-star repo from a two-person org stays, and should.
--
-- ── ON PERSONAL DATA, WHICH THE BRIEF TOUCHES ───────────────────────────────
--   `authors` stores what a person has PUBLISHED on their profile: login,
--   display name, profile URL, the blog/website field, and the public email
--   field IF they chose to set it. Those are opt-in publications.
--
--   It deliberately does NOT store emails mined from commit metadata. Commit
--   emails are exposed as a side effect of how git works, not as a decision to
--   publish a contact address, and GitHub's Acceptable Use Policies prohibit
--   using information from the service to send unsolicited email or to sell
--   personal information. Building a commit-email harvester into the pipeline
--   would put the product on the wrong side of that, and the profile email
--   field gets the same result for anyone who actually wants to be contacted.
--
-- Rollback: supabase/rollback/20260726140000_oss_sourcing_layer_down.sql
--
-- Idempotent.
-- =============================================================================

-- ── 1. Owner denylist ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oss_excluded_owners (
  owner_login text PRIMARY KEY,
  reason      text,
  added_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE oss_excluded_owners IS
  'Owner logins that cannot be a startup — big tech, foundations, universities, package registries. Data rather than a code constant so the list can be tuned without a redeploy. Not a quality filter: it removes organisations by identity, never by size.';

INSERT INTO oss_excluded_owners (owner_login, reason) VALUES
  ('google', 'big tech'), ('google-deepmind', 'big tech'), ('googleapis', 'big tech'),
  ('tensorflow', 'big tech'), ('facebook', 'big tech'), ('facebookresearch', 'big tech'),
  ('meta-llama', 'big tech'), ('pytorch', 'big tech'), ('microsoft', 'big tech'),
  ('azure', 'big tech'), ('dotnet', 'big tech'), ('apple', 'big tech'),
  ('amzn', 'big tech'), ('aws', 'big tech'), ('awslabs', 'big tech'),
  ('nvidia', 'big tech'), ('NVIDIA', 'big tech'), ('intel', 'big tech'),
  ('openai', 'established'), ('anthropics', 'established'), ('huggingface', 'platform'),
  ('deepseek-ai', 'established'), ('Qwen', 'established'), ('mistralai', 'established'),
  ('stabilityai', 'established'), ('databricks', 'established'), ('salesforce', 'big tech'),
  ('ibm', 'big tech'), ('IBM', 'big tech'), ('oracle', 'big tech'), ('adobe', 'big tech'),
  ('apache', 'foundation'), ('kubernetes', 'foundation'), ('cncf', 'foundation'),
  ('rust-lang', 'foundation'), ('nodejs', 'foundation'), ('python', 'foundation'),
  ('golang', 'foundation'), ('llvm', 'foundation'), ('linuxfoundation', 'foundation'),
  ('EleutherAI', 'research collective'), ('allenai', 'research institute'),
  ('bigscience-workshop', 'research collective'),
  ('DefinitelyTyped', 'registry'), ('npm', 'registry'), ('actions', 'platform')
ON CONFLICT (owner_login) DO NOTHING;

-- ── 2. Projects ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oss_projects (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  source            text        NOT NULL CHECK (source IN (
                                  'github_repo',
                                  'huggingface_model',
                                  'huggingface_dataset',
                                  'huggingface_space')),

  -- "owner/name" on both platforms. With source, the natural key.
  external_id       text        NOT NULL CHECK (btrim(external_id) <> ''),

  owner_login       text        NOT NULL,
  -- 'user' or 'organization'. A solo user account is a stronger pre-company
  -- signal than an org, which usually means somebody already formalised.
  owner_type        text,
  name              text        NOT NULL,
  url               text,
  description       text,
  homepage          text,       -- the project's own site, if it has one yet

  tags              text[],     -- HF tags / GitHub topics
  primary_language  text,       -- GitHub only

  -- When the project was created UPSTREAM, not when we first saw it. The
  -- single most important filter in this layer: a repo created three weeks ago
  -- gaining stars fast is the thing worth catching, and one created in 2015
  -- gaining them fast is a project having a moment.
  created_at_source timestamptz,

  -- People who have published a profile, as
  -- [{"login":"...","name":"...","profile_url":"...","website":"...","email":"..."}].
  -- Profile fields only — see the header on why commit emails are not here.
  authors           jsonb       NOT NULL DEFAULT '[]'::jsonb,

  startup_id        uuid        REFERENCES startups (id) ON DELETE SET NULL,

  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oss_projects_unique UNIQUE (source, external_id),
  CONSTRAINT oss_projects_authors_is_array CHECK (jsonb_typeof(authors) = 'array')
);

COMMENT ON TABLE oss_projects IS
  'Tracked open-source projects — GitHub repos, Hugging Face models/datasets/spaces. One row per project; the counters live in oss_project_metrics because a level overwritten in place destroys the velocity this layer exists to measure.';
COMMENT ON COLUMN oss_projects.created_at_source IS
  'Creation time on the upstream platform, NOT when we first saw it. The key filter: fast growth on a three-week-old repo is a company forming; the same growth on a ten-year-old repo is a project having a moment.';
COMMENT ON COLUMN oss_projects.authors IS
  'Published profile fields only — login, display name, profile URL, website, and the public email field where the person chose to set one. Commit-metadata emails are deliberately excluded: they are a side effect of git, not a decision to publish a contact address.';

CREATE INDEX IF NOT EXISTS idx_oss_projects_owner ON oss_projects (owner_login);
CREATE INDEX IF NOT EXISTS idx_oss_projects_created ON oss_projects (created_at_source DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_oss_projects_tags ON oss_projects USING gin (tags) WHERE tags IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oss_projects_unlinked ON oss_projects (last_seen_at DESC) WHERE startup_id IS NULL;

-- ── 3. Metrics time series ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oss_project_metrics (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES oss_projects (id) ON DELETE CASCADE,
  observed_at  timestamptz NOT NULL DEFAULT now(),

  -- GitHub
  stars        integer,
  forks        integer,
  open_issues  integer,
  -- Hugging Face
  likes        integer,
  downloads    bigint,     -- monthly downloads run into the hundreds of millions

  CONSTRAINT oss_project_metrics_unique UNIQUE (project_id, observed_at),
  -- A counter cannot be negative. Catches a parse that read the wrong field
  -- far more cheaply than noticing impossible velocities later.
  CONSTRAINT oss_project_metrics_non_negative CHECK (
    COALESCE(stars, 0) >= 0 AND COALESCE(forks, 0) >= 0
    AND COALESCE(likes, 0) >= 0 AND COALESCE(downloads, 0) >= 0)
);

COMMENT ON TABLE oss_project_metrics IS
  'Append-only counter snapshots. Velocity is a DIFFERENCE between rows here — neither GitHub nor Hugging Face exposes history, so the only way to know a growth rate is to have measured twice. The first crawl establishes a baseline and yields no velocity; that is correct behaviour, not a failure.';

-- The velocity view reads "latest per project" and "nearest observation before
-- T-24h / T-7d", both of which this index serves.
CREATE INDEX IF NOT EXISTS idx_oss_metrics_project_time
  ON oss_project_metrics (project_id, observed_at DESC);

-- ── 4. Velocity ─────────────────────────────────────────────────────────────
-- LATERAL rather than window functions: we want the observation NEAREST to
-- 24h/7d ago, not the previous row. Crawls are not evenly spaced — a missed
-- run, a rate limit, a manual invocation — so "the row before this one" could
-- be an hour ago or a fortnight, and dividing by a wrong interval invents
-- growth that did not happen.
CREATE OR REPLACE VIEW oss_project_velocity AS
WITH latest AS (
  SELECT DISTINCT ON (project_id)
         project_id, observed_at, stars, forks, likes, downloads
    FROM oss_project_metrics
   ORDER BY project_id, observed_at DESC
)
SELECT
  p.id                        AS project_id,
  p.source,
  p.external_id,
  p.owner_login,
  p.owner_type,
  p.name,
  p.url,
  p.tags,
  p.primary_language,
  p.created_at_source,
  p.startup_id,
  -- Age in days at the latest observation. NULL when the platform did not tell
  -- us when the project was created.
  CASE WHEN p.created_at_source IS NOT NULL
       THEN EXTRACT(EPOCH FROM (l.observed_at - p.created_at_source)) / 86400.0
  END::numeric(10,1)          AS age_days,
  l.observed_at               AS last_observed_at,
  l.stars, l.forks, l.likes, l.downloads,

  -- Deltas. NULL — not zero — when there is no comparable earlier observation.
  -- Zero means "measured twice and it did not move", which is a real and very
  -- different finding from "we have only looked once".
  (l.stars     - d1.stars)     AS stars_delta_1d,
  (l.likes     - d1.likes)     AS likes_delta_1d,
  (l.downloads - d1.downloads) AS downloads_delta_1d,
  (l.stars     - d7.stars)     AS stars_delta_7d,
  (l.likes     - d7.likes)     AS likes_delta_7d,
  (l.downloads - d7.downloads) AS downloads_delta_7d,

  -- Normalised per day, because the "24h" observation is rarely exactly 24h
  -- old. Divide by the interval actually measured, never by the nominal one.
  CASE WHEN d7.observed_at IS NOT NULL
        AND l.observed_at > d7.observed_at
       THEN ((l.stars - d7.stars)::numeric
             / (EXTRACT(EPOCH FROM (l.observed_at - d7.observed_at)) / 86400.0))
  END::numeric(12,2)          AS stars_per_day_7d,
  CASE WHEN d7.observed_at IS NOT NULL
        AND l.observed_at > d7.observed_at
       THEN ((l.likes - d7.likes)::numeric
             / (EXTRACT(EPOCH FROM (l.observed_at - d7.observed_at)) / 86400.0))
  END::numeric(12,2)          AS likes_per_day_7d,

  d1.observed_at              AS compared_1d_at,
  d7.observed_at              AS compared_7d_at,
  (SELECT count(*) FROM oss_project_metrics m WHERE m.project_id = p.id) AS observations
FROM oss_projects p
JOIN latest l ON l.project_id = p.id
-- Both windows are BOUNDED AT BOTH ENDS, so the column name is true. With only
-- a lower bound, a project whose sole earlier snapshot was three weeks old
-- would report that difference as `stars_delta_1d` — a three-week gain
-- presented as a daily one, which is the single most flattering way this view
-- could lie. NULL when nothing falls in the window is the honest answer:
-- "we did not measure over that period", which `compared_*_at` makes checkable.
LEFT JOIN LATERAL (
  SELECT m.observed_at, m.stars, m.likes, m.downloads
    FROM oss_project_metrics m
   WHERE m.project_id = p.id
     AND m.observed_at <= l.observed_at - INTERVAL '20 hours'
     AND m.observed_at >= l.observed_at - INTERVAL '48 hours'
   ORDER BY m.observed_at DESC
   LIMIT 1
) d1 ON true
LEFT JOIN LATERAL (
  SELECT m.observed_at, m.stars, m.likes, m.downloads
    FROM oss_project_metrics m
   WHERE m.project_id = p.id
     AND m.observed_at <= l.observed_at - INTERVAL '6 days'
     AND m.observed_at >= l.observed_at - INTERVAL '10 days'
   ORDER BY m.observed_at DESC
   LIMIT 1
) d7 ON true;

COMMENT ON VIEW oss_project_velocity IS
  'Growth rates per project, derived from repeated observations. Deltas are NULL when no comparable earlier snapshot exists — distinct from 0, which means measured twice and unchanged. Per-day rates divide by the interval ACTUALLY measured, since crawls are not evenly spaced. `observations` = 1 means baseline only.';

GRANT SELECT ON oss_projects, oss_project_metrics, oss_project_velocity, oss_excluded_owners TO authenticated;
GRANT ALL    ON oss_projects, oss_project_metrics, oss_excluded_owners TO service_role;
GRANT ALL    ON oss_project_velocity TO service_role;
REVOKE ALL   ON oss_projects, oss_project_metrics, oss_project_velocity, oss_excluded_owners FROM anon;

ALTER TABLE oss_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE oss_project_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE oss_excluded_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oss_projects_read ON oss_projects;
CREATE POLICY oss_projects_read ON oss_projects FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oss_projects_service ON oss_projects;
CREATE POLICY oss_projects_service ON oss_projects FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS oss_metrics_read ON oss_project_metrics;
CREATE POLICY oss_metrics_read ON oss_project_metrics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oss_metrics_service ON oss_project_metrics;
CREATE POLICY oss_metrics_service ON oss_project_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS oss_excluded_read ON oss_excluded_owners;
CREATE POLICY oss_excluded_read ON oss_excluded_owners FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oss_excluded_service ON oss_excluded_owners;
CREATE POLICY oss_excluded_service ON oss_excluded_owners FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. Ingest RPC ───────────────────────────────────────────────────────────
-- Upsert the project and APPEND a metrics row, in one transaction. Splitting
-- these into two PostgREST calls would let a project exist with no observation,
-- which reads downstream as a project whose counters we failed to collect.
CREATE OR REPLACE FUNCTION record_oss_observation(
  p_source            text,
  p_external_id       text,
  p_owner_login       text,
  p_name              text,
  p_url               text        DEFAULT NULL,
  p_description       text        DEFAULT NULL,
  p_homepage          text        DEFAULT NULL,
  p_owner_type        text        DEFAULT NULL,
  p_tags              text[]      DEFAULT NULL,
  p_primary_language  text        DEFAULT NULL,
  p_created_at_source timestamptz DEFAULT NULL,
  p_authors           jsonb       DEFAULT '[]'::jsonb,
  p_stars             integer     DEFAULT NULL,
  p_forks             integer     DEFAULT NULL,
  p_open_issues       integer     DEFAULT NULL,
  p_likes             integer     DEFAULT NULL,
  p_downloads         bigint      DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_new     boolean := false;
  v_metrics integer;
BEGIN
  IF p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'record_oss_observation: external_id is required (it is the dedupe key)';
  END IF;

  INSERT INTO oss_projects (
    source, external_id, owner_login, owner_type, name, url, description,
    homepage, tags, primary_language, created_at_source, authors
  ) VALUES (
    p_source, btrim(p_external_id), p_owner_login, p_owner_type, p_name, p_url, p_description,
    p_homepage, p_tags, p_primary_language, p_created_at_source, COALESCE(p_authors, '[]'::jsonb)
  )
  ON CONFLICT (source, external_id) DO UPDATE
    SET description      = COALESCE(EXCLUDED.description, oss_projects.description),
        homepage         = COALESCE(EXCLUDED.homepage, oss_projects.homepage),
        tags             = COALESCE(EXCLUDED.tags, oss_projects.tags),
        primary_language = COALESCE(EXCLUDED.primary_language, oss_projects.primary_language),
        -- created_at_source never changes upstream; keep the first value seen
        -- rather than letting a null-returning response erase it.
        created_at_source = COALESCE(oss_projects.created_at_source, EXCLUDED.created_at_source),
        -- Same rule as officers/managers: an empty list is a failed lookup.
        authors          = CASE WHEN jsonb_array_length(EXCLUDED.authors) > 0
                                THEN EXCLUDED.authors ELSE oss_projects.authors END,
        last_seen_at     = now()
  RETURNING id, (xmax = 0) INTO v_id, v_new;

  -- Append the observation. Only when at least one counter came back: a row of
  -- all-NULLs is not a measurement, and it would poison the velocity view by
  -- becoming the "latest" snapshot with nothing in it.
  IF p_stars IS NOT NULL OR p_likes IS NOT NULL OR p_downloads IS NOT NULL OR p_forks IS NOT NULL THEN
    INSERT INTO oss_project_metrics (project_id, stars, forks, open_issues, likes, downloads)
    VALUES (v_id, p_stars, p_forks, p_open_issues, p_likes, p_downloads);
  END IF;

  SELECT count(*) INTO v_metrics FROM oss_project_metrics WHERE project_id = v_id;

  RETURN jsonb_build_object(
    'project_id',   v_id,
    'created',      v_new,
    'observations', v_metrics,
    -- Explicit, because the first run looking "empty" is the predictable
    -- confusion with this whole design.
    'has_velocity', v_metrics > 1
  );
END;
$$;

REVOKE ALL ON FUNCTION record_oss_observation(text,text,text,text,text,text,text,text,text[],text,timestamptz,jsonb,integer,integer,integer,integer,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_oss_observation(text,text,text,text,text,text,text,text,text[],text,timestamptz,jsonb,integer,integer,integer,integer,bigint) TO service_role;
