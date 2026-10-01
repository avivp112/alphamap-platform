-- =============================================================================
-- Migration: schedule_embedding_backfill
-- Created:   2026-10-04
-- Description:
--   Closes the one remaining gap in "fetch -> link -> embed -> alert"
--   (see 20261003000000's header): embedding generation
--   (supabase/functions/backfill-embeddings, which replaces the orphaned
--   scripts/backfill_embeddings.ts -- never wired to any scheduler, GitHub
--   Actions or GitLab CI) now runs the same way every other step of this
--   pipeline already does -- pg_cron + pg_net, same as
--   20260726250000_sourcing_ingestion_cron.sql.
--
-- ── CADENCE AND ORDERING ─────────────────────────────────────────────────────
--   04:00 daily -- after every daily ingester (00:10-00:55) and both daily
--   resolvers (link_oss_projects 03:00, resolve_tier1 03:15), so the day's
--   newly-created and newly-linked startups exist and are correctly
--   startup_id-linked before this runs. generate_live_alerts() then ticks
--   every 30 minutes around the clock, so a startup embedded at 04:00 is
--   evaluated for a thesis-match alert within half an hour of becoming
--   matchable -- comfortably inside its default 2-hour lookback window.
--
-- ── LIVE, NOT DRY-RUN, BY DEFAULT HERE ───────────────────────────────────────
--   The Edge Function defaults to dryRun:true when called with no body (same
--   safety convention as link_oss_projects/resolve_tier1 defaulting to
--   p_dry_run => true in their own definitions) -- this migration's cron
--   command explicitly passes {"dryRun": false}, a deliberate one-time
--   decision made here, not a bypass. This is safe to run unattended because
--   an embedding write is trivially inspectable and reversible (UPDATE
--   startups SET embedding = NULL, embedding_source_hash = NULL,
--   embedding_updated_at = NULL WHERE id = ...) and, unlike resolve_tier1's
--   merges, never deletes a row or changes a foreign key -- the worst case of
--   a bad embedding is a startup ranking oddly in semantic search, not data
--   loss.
--
-- ── PREREQUISITE ─────────────────────────────────────────────────────────────
--   RUNPOD_TEI_URL must be set as an Edge Function secret before this job's
--   first live run (as of 20261005000000_update_embedding_vector_dimensions,
--   which moved embedding generation off OpenAI onto a self-hosted TEI
--   server), exactly like every other connector's own endpoint/credential:
--     supabase secrets set RUNPOD_TEI_URL="https://<POD_ID>-8080.proxy.runpod.net"
--   A missing value returns a clean error response, which pg_cron records as a
--   failed run in cron.job_run_details (same failure mode documented in
--   20260726250000 for a connector missing its own credential) -- it does
--   not crash or affect any other scheduled job.
--
-- Rollback: supabase/rollback/20261004000000_schedule_embedding_backfill_down.sql
-- Idempotent: unschedules by name before scheduling.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-embeddings') THEN
    PERFORM cron.unschedule('backfill-embeddings');
  END IF;
END;
$$;

SELECT cron.schedule(
  'backfill-embeddings', '0 4 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/backfill-embeddings',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := jsonb_build_object('dryRun', false, 'table', 'both'),
    timeout_milliseconds := 300000
  );
  $cron$
);

-- Confirm what got scheduled.
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'backfill-embeddings';
