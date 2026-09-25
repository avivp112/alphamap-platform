-- =============================================================================
-- Migration: cron.job_run_details audit fixes — dead job, broken URL
-- Created:   2026-09-30
-- Description:
--   Two issues surfaced by auditing cron.job_run_details directly (not by
--   grepping migrations — see the note on each below for why that grep came
--   up empty).
--
-- ── 1. process-enrichment-queue: NOT DEFINED IN ANY TRACKED MIGRATION ───────
--   Searched every .sql file in this repo for "process-enrichment-queue",
--   "fn_process_enrichment_queue", and "enrichment_queue" — zero matches.
--   This job was scheduled by a raw `cron.schedule(...)` call run directly
--   against the database at some point, outside of version control, calling
--   a function (fn_process_enrichment_queue) that isn't defined anywhere in
--   this codebase either. There is no "registration" to remove from a
--   migration because none exists here — this migration's only job is to
--   unschedule the live artifact itself. If fn_process_enrichment_queue()
--   still exists as a function in the database, it is left alone: dropping a
--   function nothing in this repo defines or calls is out of scope for a
--   cron cleanup, and it's inert once nothing schedules it.
--
-- ── 2. sync-public-markets-daily: WAS ONLY EVER A README SNIPPET ────────────
--   Same search, same result: no migration defines this job either. It comes
--   from supabase/functions/sync-public-markets/README.md's "paste into the
--   Dashboard SQL Editor once" instructions, written before this project's
--   sourcing_required_secret() vault-secret pattern existed (20260726080000).
--   That snippet hardcoded a literal `<PROJECT_REF>` placeholder and sent no
--   Authorization header — exactly what's live today, meaning someone copied
--   it in unmodified. The README is fixed alongside this migration so the
--   next person copying it gets the working version; this migration fixes
--   the already-live job to match.
--
--   sync-public-markets itself is deployed --no-verify-jwt (see .gitlab-ci.yml),
--   so the missing Authorization header was not why nothing ran — cron.job_run
--   _details would show a wrong-host connection failure instead, since
--   <PROJECT_REF> was never a real hostname. The header is added anyway for
--   consistency with every other scheduled job in this project and because
--   -no-verify-jwt is a deploy-time flag, not a guarantee this function will
--   stay open to unauthenticated callers forever.
--
--   cron.schedule() upserts by job name — scheduling 'sync-public-markets-daily'
--   again replaces the existing broken job in place, no unschedule needed
--   first. The unschedule guard IS used for process-enrichment-queue, since
--   that one is being removed outright, not replaced.
--
-- Rollback: supabase/rollback/20260930010000_cron_job_audit_fixes_down.sql
-- Idempotent.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. Remove the dead job ───────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-enrichment-queue') THEN
    PERFORM cron.unschedule('process-enrichment-queue');
  END IF;
END;
$$;

-- ── 2. Fix the broken URL + missing auth ─────────────────────────────────────
SELECT cron.schedule(
  'sync-public-markets-daily',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/sync-public-markets',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

-- Confirm end state: process-enrichment-queue absent, sync-public-markets-daily
-- present and using the vault helper (visible by reading `command` below).
SELECT jobname, schedule, active, command
  FROM cron.job
 WHERE jobname IN ('process-enrichment-queue', 'sync-public-markets-daily')
 ORDER BY jobname;
