-- =============================================================================
-- Migration: schedule the 6 ingestion functions and 4 entity resolvers
-- Created:   2026-07-26
-- Description:
--   Sourcing Engine audit, Step 6. Confirmed by the Phase 1 audit: none of the
--   6 ingestion Edge Functions (SEC Form D, UK Companies House, USPTO, EPO,
--   GitHub, Hugging Face) and none of the entity resolvers were ever
--   scheduled -- only the ATS layer (discover-boards / sourcing-crawl /
--   extract-job-signals, 20260726100000) runs on its own. Every source in
--   this file has been running at whatever cadence someone remembered to curl
--   it, which is to say not at all since the Phase 1 audit found nothing had
--   ever executed against a live API from this environment.
--
-- ── TWO DIFFERENT KINDS OF JOB, TWO DIFFERENT MECHANISMS ────────────────────
--   The 6 ingesters are Edge Functions, reached the same way
--   20260726080000/100000 already reach the ATS layer's: net.http_post with
--   an Authorization header built from sourcing_required_secret(), which
--   reads the 'project_url' / 'service_role_key' Vault secrets that
--   deployment already set up. Nothing new to configure there, and this
--   migration does not redefine that function.
--
--   The 4 resolvers (link_oss_projects, resolve_tier1, queue_tier2_candidates,
--   queue_tier3_candidates) are plain SQL functions living in the SAME
--   database pg_cron runs in. They are called directly -- SELECT
--   function(...) -- with no HTTP round trip, no auth header, and no Edge
--   Function timeout to worry about.
--
-- ── TWO SEPARATE SECRET SYSTEMS -- DO NOT CONFUSE THEM ──────────────────────
--   Vault secrets ('project_url', 'service_role_key') are what THIS FILE uses
--   to call an Edge Function from inside Postgres. They already exist if
--   20260726080000 was set up.
--
--   Each ingester ALSO needs its own upstream API credential, set as an Edge
--   Function environment secret via `supabase secrets set`, completely
--   unrelated to Vault:
--     ingest-sec-form-d          SEC_USER_AGENT           (required)
--     ingest-uk-companies-house  COMPANIES_HOUSE_API_KEY  (required)
--     ingest-uspto-patents       PATENTSVIEW_API_KEY      (required)
--     ingest-epo-ops             EPO_OPS_KEY, EPO_OPS_SECRET (required)
--     ingest-github-velocity     GITHUB_TOKEN             (required, scopeless)
--     ingest-huggingface         HUGGINGFACE_TOKEN        (optional)
--   A function missing its own credential returns an error response, not a
--   crash pg_cron surfaces loudly -- it will show up as a failed row in
--   cron.job_run_details, quietly, once a day, until someone looks. Set these
--   BEFORE this migration runs, or the schedule will just accumulate
--   failures for whichever functions are missing theirs.
--
-- ── CADENCE, AND WHERE EACH NUMBER CAME FROM ────────────────────────────────
--   Every ingester defaults to a well-defined, already-documented window when
--   POSTed an empty body -- that is the "POST {}" line in each function's own
--   header, and the ONLY invocation exercised by this audit's dry-run
--   verification (Step 1). This migration relies on those defaults rather
--   than re-specifying limits here, so the schedule can never silently drift
--   from what each function's own header claims is safe to call unattended.
--
--     SEC Form D            daily    -> defaults to "yesterday's filings"
--     UK Companies House    daily    -> defaults to "yesterday's incorporations"
--     GitHub velocity       daily    -> function's own header: "Schedule it
--                                        daily; that is the entire point of
--                                        the metrics table" (velocity needs
--                                        two observations)
--     Hugging Face          daily    -> function's own header: "Schedule it
--                                        daily. The value compounds only
--                                        with repetition"
--     USPTO patents         weekly   -> defaults to "last 7 days"; matches
--                                        USPTO's own weekly publication
--                                        cadence exactly, no gap and no
--                                        wasted re-fetching
--     EPO OPS                weekly   -> defaults to "last 14 days", a full
--                                        week of overlap past a weekly
--                                        cadence as a safety margin against
--                                        one missed run; ON CONFLICT makes
--                                        the overlap free
--
--   All four resolvers run daily, staggered after the daily ingesters so the
--   day's identifiers exist before the resolvers look for them:
--     link_oss_projects        03:00  links yesterday's GitHub/HF projects
--     resolve_tier1            03:15  merges on whatever link_oss_projects
--                                      and the day's gov ingesters just wrote
--     queue_tier2_candidates   03:30  weekly (Monday) -- review-queue volume,
--     queue_tier3_candidates   03:45  weekly (Monday)    not urgent daily
--
-- ── resolve_tier1 AND link_oss_projects RUN LIVE (p_dry_run => false) ───────
--   Read this before deploying. Both default to dry-run in their own
--   definitions (20260726200000, 20260726230000) precisely so a fat-fingered
--   manual call cannot merge anything by accident. Scheduling them here with
--   dry_run explicitly set to false is a deliberate, one-time decision made
--   in this file, not a bypass of that caution -- the same shape as
--   discover-boards/sourcing-crawl already running unattended and writing
--   real rows in 20260726100000.
--
--   This is safe to do BECAUSE of what each function actually does on a
--   match: link_oss_projects only ever sets a foreign key to a startup that
--   already exists (trivially reversible: UPDATE oss_projects SET
--   startup_id = NULL). resolve_tier1 merges only on a shared STRONG
--   identifier -- domain, CIK, Companies House number, GitHub org, HF
--   namespace, ATS token -- which its own header states plainly has "no
--   realistic false positive", and every merge is fully reversible via
--   unmerge_company() because merge_companies() snapshots the pre-merge row.
--   Tier 2 and Tier 3 are NOT run live here for the opposite reason: they are
--   correct to only ever queue, never auto-merge (see 20260726200000's tier
--   policy) and this file does not change p_auto from its default of false.
--
--   To pause live resolution without dropping the schedule:
--     SELECT cron.alter_job(
--       (SELECT jobid FROM cron.job WHERE jobname = 'resolve-tier1-identity'),
--       command => $$SELECT resolve_tier1(50, true, 'cron:resolve-tier1-identity');$$
--     );
--   (and the equivalent for 'link-oss-projects'), which flips both back to
--   dry-run reporting without touching the cadence.
--
-- Rollback: supabase/rollback/20260726250000_sourcing_ingestion_cron_down.sql
-- Idempotent: unschedules by name before scheduling.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'ingest-sec-form-d', 'ingest-uk-companies-house', 'ingest-uspto-patents',
    'ingest-epo-ops', 'ingest-github-velocity', 'ingest-huggingface',
    'link-oss-projects', 'resolve-tier1-identity',
    'queue-tier2-candidates', 'queue-tier3-candidates'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;

-- ── Daily gov + OSS ingesters, staggered 15 minutes apart ───────────────────

SELECT cron.schedule(
  'ingest-sec-form-d', '10 0 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-sec-form-d',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

SELECT cron.schedule(
  'ingest-uk-companies-house', '25 0 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-uk-companies-house',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

SELECT cron.schedule(
  'ingest-github-velocity', '40 0 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-github-velocity',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

SELECT cron.schedule(
  'ingest-huggingface', '55 0 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-huggingface',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

-- ── Weekly patent ingesters, Monday, matching their own publication cadence ─

SELECT cron.schedule(
  'ingest-uspto-patents', '30 1 * * 1',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-uspto-patents',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

SELECT cron.schedule(
  'ingest-epo-ops', '0 2 * * 1',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-epo-ops',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

-- ── Resolvers: direct SQL calls, no HTTP round trip ─────────────────────────

-- LIVE. See the header note above before changing p_dry_run here.
SELECT cron.schedule(
  'link-oss-projects', '0 3 * * *',
  $cron$ SELECT link_oss_projects(500, false); $cron$
);

-- LIVE. See the header note above before changing p_dry_run here.
SELECT cron.schedule(
  'resolve-tier1-identity', '15 3 * * *',
  $cron$ SELECT resolve_tier1(50, false, 'cron:resolve-tier1-identity'); $cron$
);

-- Queues for human review only -- never auto-merges (p_auto left at its
-- default of false). Weekly: the tier's own numbers (60 groups measured on
-- production) are an afternoon's work, not a daily one.
SELECT cron.schedule(
  'queue-tier2-candidates', '30 3 * * 1',
  $cron$ SELECT queue_tier2_candidates(500, false); $cron$
);

SELECT cron.schedule(
  'queue-tier3-candidates', '45 3 * * 1',
  $cron$ SELECT queue_tier3_candidates(0.86, 200); $cron$
);

-- Confirm what got scheduled.
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname IN (
   'ingest-sec-form-d', 'ingest-uk-companies-house', 'ingest-uspto-patents',
   'ingest-epo-ops', 'ingest-github-velocity', 'ingest-huggingface',
   'link-oss-projects', 'resolve-tier1-identity',
   'queue-tier2-candidates', 'queue-tier3-candidates'
 )
 ORDER BY jobname;
