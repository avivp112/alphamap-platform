-- =============================================================================
-- Migration: sourcing pipeline cadence — add discovery, raise throughput
-- Created:   2026-07-26
-- Description:
--   Replaces the two weekly jobs from 20260726080000 with three, and moves the
--   pipeline off manual speed.
--
--     :05  hourly        sourcing-discover-boards   limit   50
--     :20  every 2 hours sourcing-crawl-batch       limit  100
--     :50  hourly        sourcing-extract-signals   limit 2000
--
--   Minutes are staggered so the three never start together and queue behind
--   each other inside pg_net's worker pool.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--   discover-boards was written AFTER 20260726080000, so it was never
--   scheduled at all. With 4,324 companies sitting in board_discovery_candidates
--   and a hand-invoked function as the only way to move them, the front of the
--   pipeline ran at whatever rate somebody remembered to curl it. Everything
--   downstream was capped by that.
--
--   The weekly crawl had the same problem from the other end. At 50 boards a
--   week against an expected ~3,000 registered boards (4,324 candidates x the
--   70% hit rate measured on the first real run), one full sweep took 60 weeks.
--
-- ── WHY DISCOVERY IS HOURLY AND THE CRAWL IS NOT ────────────────────────────
--   Both hit the same four third-party ATS hosts, so the honest question is
--   how much traffic we point at somebody else's public endpoint.
--
--   Discovery is a BURST THAT ENDS. 4,324 candidates at 50 per run drains in
--   ~87 hours, and every company is stamped board_discovery_at on hit or miss
--   so nothing is ever re-probed. Once the queue empties, each run costs one
--   indexed query returning zero rows, forever. Paying ~3.6 days of elevated
--   traffic to finish a one-time backfill is a good trade.
--
--   The crawl is PERMANENT LOAD. It re-walks every board it has ever
--   registered, so its cadence is a standing commitment, not a burst. Two
--   hours keeps it at ~600 board-fetches a day while still sweeping 3,000
--   boards every ~2.5 days — job boards do not change hourly, and a fresher
--   number is not worth doubling a permanent load on hosts that owe us
--   nothing.
--
-- ── WHY THE CRAWL BATCH DOUBLES TO 100 BUT DISCOVERY STAYS AT 50 ────────────
--   20260726080000 argued for raising cadence rather than batch size, on the
--   grounds that a batch overrunning the Edge Function wall clock loses the
--   work. That argument turns out not to apply to the crawler: crawlBoard
--   stamps last_crawled_at per board, and on failure too, while batch mode
--   selects last_crawled_at ASC NULLS FIRST. A timeout therefore TRUNCATES the
--   batch — the next run resumes at the stalest board it did not reach. Worst
--   case is a short batch and a noisy row in cron.job_run_details, not lost
--   work, so 100 is safe. 200 (the function's MAX_LIMIT) probably is too, but
--   doubling is the step actually supported by evidence.
--
--   Discovery has no such property in the same measure: its costliest work is
--   the misses, at up to 12 requests each, and its own MAX_LIMIT is 50. Left
--   alone.
--
--   Extraction was ALREADY at its MAX_LIMIT of 2000 in the weekly job, so its
--   throughput increase comes entirely from cadence: 2,000/week becomes up to
--   48,000/day. It touches no third-party host — it reads titles already in
--   the database — so frequency costs nothing but a cheap indexed query when
--   there is nothing pending.
--
-- ── SECRETS ─────────────────────────────────────────────────────────────────
--   Unchanged: both are read from Vault at run time via
--   sourcing_required_secret(), defined in 20260726080000, which rejects
--   missing values and un-substituted placeholders. This migration does not
--   redefine it and contains no credentials.
--
-- Rollback: supabase/rollback/20260726100000_sourcing_cron_cadence_down.sql
--
-- Idempotent: unschedules by name before scheduling, including the superseded
-- weekly job names.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop the superseded weekly jobs and any prior run of this migration.
-- cron.unschedule throws on an absent job, hence the per-name guard.
DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'sourcing-weekly-crawl',      -- superseded by sourcing-crawl-batch
    'sourcing-weekly-extract',    -- superseded by sourcing-extract-signals
    'sourcing-discover-boards',
    'sourcing-crawl-batch',
    'sourcing-extract-signals'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END;
$$;

-- ── 1. Discovery — hourly at :05 ────────────────────────────────────────────
-- Turns startups rows into registered ATS boards. Self-terminating: returns
-- "no candidates pending" for one cheap query once the backfill completes.
SELECT cron.schedule(
  'sourcing-discover-boards',
  '5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/discover-boards',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := jsonb_build_object('limit', 50),
    timeout_milliseconds := 300000
  );
  $cron$
);

-- ── 2. Crawl — every 2 hours at :20 ─────────────────────────────────────────
-- Walks registered boards stalest-first. Safe to truncate: progress is stamped
-- per board, so the next run picks up where this one stopped.
SELECT cron.schedule(
  'sourcing-crawl-batch',
  '20 */2 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/sourcing-crawl',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := jsonb_build_object('limit', 100),
    timeout_milliseconds := 300000
  );
  $cron$
);

-- ── 3. Extraction — hourly at :50 ───────────────────────────────────────────
-- Thirty minutes behind the crawl. pg_net is asynchronous — net.http_post
-- returns a request id, not a result — so the two genuinely cannot be chained
-- and a time gap is the only ordering available. Thirty minutes is generous
-- against a 100-board crawl that returns in well under two.
--
-- No reextract flag: a schedule should only process postings never seen
-- before. Re-running the whole corpus is a deliberate act after a taxonomy
-- change, not something a cron does behind your back.
SELECT cron.schedule(
  'sourcing-extract-signals',
  '50 * * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/extract-job-signals',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')
               ),
    body    := jsonb_build_object('limit', 2000),
    timeout_milliseconds := 300000
  );
  $cron$
);

-- Confirm what got scheduled. The superseded weekly names must be absent.
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname LIKE 'sourcing-%'
 ORDER BY jobname;
