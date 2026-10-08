-- =============================================================================
-- Pipeline repair — 2026-10-12
--
-- The migrations below are in the repository but were never applied to this
-- database (found with pipeline_health_snapshot() and the catalogue checks on
-- 2026-10-11). Each section is the migration file exactly as it is in
-- supabase/migrations/, in the order that works:
--   20260925000000_preference_vector_recompute.sql
--     recompute_user_preference_vectors() and its 30-minute schedule — missing in the database
--   20260926000000_match_scores_rpc.sql
--     match_scores_for_startups() — missing (Match Score badge)
--   20260927000000_hybrid_lookalikes_rpc.sql
--     hybrid_lookalikes() — missing
--   20261005000000_update_embedding_vector_dimensions.sql
--     embedding columns 1536 -> 768 (the TEI model). The database is still at 1536, so every embedding write would fail
--   20261004000000_schedule_embedding_backfill.sql
--     the daily 04:00 backfill-embeddings job — not scheduled
--   20260726190000_company_merge.sql
--     merge functions brought to the current version (the database runs an older one)
--   20261012000000_merge_unique_values_and_cron_cleanup.sql
--     merge_companies() slug fix (resolve-tier1-identity) + stop weekly-startup-enrichment
--
-- Run ONCE, in the Supabase SQL editor. Every section is safe to re-run EXCEPT
-- the vector-dimension one, which empties all embedding columns each time it
-- runs — harmless today (no embedding was ever written; last_embedded_at is
-- NULL), destructive once embeddings exist. Investors' and users' preference
-- vectors are reset too; both are rebuilt by the scheduled jobs.
-- =============================================================================

-- ##############################################################################
-- ## 20260925000000_preference_vector_recompute.sql
-- ##############################################################################

-- =============================================================================
-- Migration: preference_vector_recompute
-- Created:   2026-09-25
-- Description:
--   Phase 4 of the preference engine: the batch job that actually populates
--   user_preference_vectors.embedding (added schema-only in
--   20260924000000_preference_engine_phase1.sql).
--
--   Scope, deliberately narrow for v1:
--     - Positive signal only. embedding = avg(startups.embedding) over the
--       user's CURRENT watchlist_items (not the user_interactions save log —
--       watchlist is the live source of truth, since un-saving something
--       doesn't log a removal event and shouldn't keep influencing the
--       vector after it's gone).
--     - No negative weighting from Pass here. Passed companies are already
--       permanently excluded from the Private Market page's results
--       (startups.sub_sector_tags... see excludeStartupIds in
--       src/lib/supabase.ts, Phase 3), so the vector doesn't also need to
--       push away from them for ranking the remaining candidates. This is
--       also a real constraint, not just a simplicity choice: the installed
--       pgvector (0.6.0) has no scalar * vector operator, so a weighted
--       "pos - 0.35*neg" subtraction needs an array_fill() workaround this
--       version doesn't cleanly support — not worth it for a v1 that's
--       already covered by the exclusion filter.
--     - Zero saves -> no row written (not a zero vector) -- Phase 5's "still
--       calibrating" UI can key off row-absence rather than a magic value.
--     - Full recompute every run, not incremental -- same philosophy as
--       refresh_startups_search(): simple and correct beats clever here,
--       and this is cheap (only users with >=1 watchlist item are touched).
--
-- Idempotent: CREATE OR REPLACE / unschedule-then-reschedule throughout.
-- Safe to paste into the Supabase SQL Editor and run more than once.
-- =============================================================================

CREATE OR REPLACE FUNCTION recompute_user_preference_vectors()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO user_preference_vectors (user_id, embedding, signal_count, updated_at)
  SELECT
    wi.user_id,
    avg(s.embedding),
    count(*),
    now()
  FROM watchlist_items wi
  JOIN startups s
    ON s.id = wi.entity_id
   AND wi.entity_type = 'startup'
   AND s.embedding IS NOT NULL
  GROUP BY wi.user_id
  HAVING count(*) > 0
  ON CONFLICT (user_id) DO UPDATE
    SET embedding    = EXCLUDED.embedding,
        signal_count = EXCLUDED.signal_count,
        updated_at   = EXCLUDED.updated_at;
$$;

COMMENT ON FUNCTION recompute_user_preference_vectors() IS
  'Phase 4 batch job: rewrites every user''s preference-vector centroid from their CURRENT watchlist (positive signal only -- see migration header for why negative/Pass weighting is deliberately out of scope for v1). Full recompute, not incremental. Runs every 30 min via pg_cron (see below) and can be called directly by the service-role client for an immediate refresh.';

REVOKE ALL ON FUNCTION recompute_user_preference_vectors() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-preference-vectors') THEN
    PERFORM cron.unschedule('recompute-preference-vectors');
  END IF;
END;
$$;

-- Every 30 minutes. Cheaper than the 15-min startups_search refresh (only
-- users with at least one watchlist item are touched, and it's a single
-- GROUP BY + avg(), not a per-row window function over the whole table), and
-- a preference vector doesn't need to be as fresh as the search results
-- themselves -- a save made 20 minutes ago doesn't need to affect ranking
-- this second.
SELECT cron.schedule(
  'recompute-preference-vectors',
  '*/30 * * * *',
  $cron$ SELECT recompute_user_preference_vectors(); $cron$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'recompute-preference-vectors';

-- ##############################################################################
-- ## 20260926000000_match_scores_rpc.sql
-- ##############################################################################

-- =============================================================================
-- Migration: match_scores_rpc
-- Created:   2026-09-26
-- Description:
--   Phase 5 of the preference engine: the read path that turns Phase 4's
--   per-user preference-vector centroid into a personalized "Match Score %"
--   the client can render next to each startup.
--
--   Batch, not per-card: the client calls this once per page of results
--   (grid or table) with every visible startup id, instead of the N-RPC-
--   calls-per-page pattern the existing calculate_alphamap_score badge uses.
--
--   Gating lives here, not in the client: a row is only returned once the
--   caller's user_preference_vectors.signal_count >= 3 (too few saves and a
--   cosine similarity is noise, not signal -- see the Phase 5 UI's "still
--   calibrating" state). An id absent from the result set means "calibrating
--   or no personalization data yet", never "0% match" -- the client must not
--   treat a missing row as a zero score.
--
--   SECURITY DEFINER + explicit auth.uid() join (same shape as
--   calculate_alphamap_score / recompute_user_preference_vectors): the
--   function can only ever read the CALLING user's own preference vector,
--   regardless of what ids are passed in, so there's no way to probe another
--   user's centroid or its similarity to an arbitrary company.
-- =============================================================================

CREATE OR REPLACE FUNCTION match_scores_for_startups(p_startup_ids uuid[])
RETURNS TABLE(startup_id uuid, match_pct integer, signal_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    s.id,
    GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer,
    pv.signal_count
  FROM startups s
  JOIN user_preference_vectors pv ON pv.user_id = auth.uid()
  WHERE s.id = ANY(p_startup_ids)
    AND s.embedding IS NOT NULL
    AND pv.signal_count >= 3;
$$;

COMMENT ON FUNCTION match_scores_for_startups(uuid[]) IS
  'Phase 5: batch personalized match score for a page of startup ids. cosine similarity between each startup''s embedding and the CALLING user''s preference-vector centroid (Phase 4), scaled to 0-100. Rows are withheld below signal_count 3 -- the client treats an absent id as "still calibrating", never as a 0% match.';

REVOKE ALL ON FUNCTION match_scores_for_startups(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_scores_for_startups(uuid[]) TO authenticated;

-- ##############################################################################
-- ## 20260927000000_hybrid_lookalikes_rpc.sql
-- ##############################################################################

-- =============================================================================
-- Migration: hybrid_lookalikes_rpc
-- Created:   2026-09-27
-- Description:
--   Phase 7 of the preference engine: "find companies like this one" for the
--   new Lookalikes Drawer. Hybrid retrieval, same two-stage shape as a
--   production vector search:
--
--     1. Candidate generation (cheap): pre-filter startups_search down to a
--        small set via idx_startups_search_sub_sector_names (GIN) — a
--        sub_sector_names array-overlap check, same index the Private
--        Market page's own sub-sector filter already relies on. Falls back
--        to an exact sector_parent match (already indexed) for a company
--        with zero sub-sector tags, so an empty tag array (which can never
--        overlap anything) doesn't leave that company with zero lookalikes
--        forever.
--     2. Re-ranking (the expensive part): only THAT narrowed candidate set
--        gets ordered by real cosine distance on startups.embedding (via
--        startups_search's `s.*`, from 20260721000000_semantic_search_pgvector),
--        never the whole table.
--
--   No RLS/security concerns beyond what startups_search already exposes
--   (public company data, same as suggested_startup_peers) -- no explicit
--   GRANT/REVOKE needed, same convention as that function.
-- =============================================================================

CREATE OR REPLACE FUNCTION hybrid_lookalikes(
  p_startup_id uuid,
  p_limit      int DEFAULT 6
)
RETURNS TABLE(peer startups_search, similarity_pct int)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH target AS (
    SELECT id, sub_sector_names, sector_parent, embedding
    FROM startups_search
    WHERE id = p_startup_id
  )
  SELECT
    peer,
    GREATEST(0, LEAST(100, round((1 - (peer.embedding <=> target.embedding)) * 100)))::int
  FROM startups_search peer, target
  WHERE peer.id <> target.id
    AND peer.embedding   IS NOT NULL
    AND target.embedding IS NOT NULL
    AND (
      peer.sub_sector_names && target.sub_sector_names
      OR peer.sector_parent = target.sector_parent
    )
  ORDER BY peer.embedding <=> target.embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION hybrid_lookalikes(uuid, int) IS
  'Phase 7: "companies like this one" for the Lookalikes Drawer. Pre-filters startups_search via the GIN-indexed sub_sector_names overlap (falling back to an exact sector_parent match for untagged companies), then re-ranks only that candidate set by real cosine distance on startups.embedding. Returns each peer as the full startups_search composite plus a 0-100 similarity_pct.';

-- ##############################################################################
-- ## 20261005000000_update_embedding_vector_dimensions.sql
-- ##############################################################################

-- =============================================================================
-- Migration: update_embedding_vector_dimensions
-- Created:   2026-10-05
-- Description: Deprecates OpenAI (text-embedding-3-small, 1536-d) as the
--              embedding provider in favour of a self-hosted Text Embeddings
--              Inference (TEI) server running nomic-ai/nomic-embed-text-v1.5
--              (768-d) on our existing RunPod instance, alongside the
--              self-hosted LLM (see supabase/functions/_shared/llm-client.ts /
--              tei-client.ts). OpenAI's and Nomic's embeddings live in
--              unrelated vector spaces — there is no way to cast one into the
--              other — so every stored embedding is irrecoverably stale and
--              must be nulled out and recomputed from scratch by the existing
--              backfill-embeddings Edge Function + pg_cron schedule
--              (20261004000000_schedule_embedding_backfill.sql). Nulling
--              embedding_updated_at is exactly what makes that happen: the
--              backfill queue is `ORDER BY embedding_updated_at NULLS FIRST`,
--              so every row self-re-queues with no separate "re-embed everything"
--              step required.
--
-- Three tables carry an embedding column; this migration finds exactly these
-- via grep across every migration file (there are no others):
--   1. startups.embedding                — HNSW-indexed, ANN-searched directly.
--   2. investors.embedding                — HNSW-indexed, ANN-searched directly.
--   3. user_preference_vectors.embedding  — NOT indexed (small table; only ever
--      used as the query-side vector in `startups.embedding <=> this`, never
--      itself ANN-searched), per 20260924000000_preference_engine_phase1.
--
-- match_companies_and_funds() (20260721000000_semantic_search_pgvector) is the
-- only RPC that hardcodes a vector dimension (in its `query_embedding
-- extensions.vector(1536)` parameter signature) and must be recreated with
-- vector(768). generate_live_alerts() and top_thesis_matches() were checked
-- and need NO changes — both only ever compare `a.embedding <=> b.embedding`
-- between two already-declared vector columns, which is dimension-agnostic by
-- construction as long as both sides share the same declared type.
--
-- Idempotent; safe to run more than once (ALTER COLUMN TYPE is a no-op once
-- already vector(768); indexes/function use IF EXISTS / CREATE OR REPLACE).
-- =============================================================================

-- 1. ── Drop the two HNSW indexes before changing column type ─────────────────
-- Postgres won't let you ALTER COLUMN TYPE on a column with a dependent index
-- in place; dropping explicitly (rather than relying on CASCADE) keeps this
-- migration's effects legible, matching this codebase's established style of
-- never leaning on implicit cascading behaviour for schema changes.
DROP INDEX IF EXISTS idx_startups_embedding_hnsw;
DROP INDEX IF EXISTS idx_investors_embedding_hnsw;

-- 2. ── Change column type on all three embedding-bearing tables ─────────────
-- `USING NULL` is the only honest cast here: a 1536-d OpenAI vector and a
-- 768-d Nomic vector do not share a coordinate space, so there is no
-- value-preserving conversion — every row must be treated as unembedded.
ALTER TABLE startups
  ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;

ALTER TABLE investors
  ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;

ALTER TABLE user_preference_vectors
  ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;

-- 3. ── Reset bookkeeping so the backfill queue re-processes every row ────────
-- embedding_updated_at = NULL sorts first in the backfill's
-- `ORDER BY embedding_updated_at NULLS FIRST, id` queue; embedding_source_hash
-- is cleared too since the OpenAI-era hash is meaningless against a
-- TEI-produced vector (though the backfill would recompute and overwrite it
-- anyway on the first pass regardless).
UPDATE startups  SET embedding_source_hash = NULL, embedding_updated_at = NULL
 WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;

UPDATE investors SET embedding_source_hash = NULL, embedding_updated_at = NULL
 WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;

-- user_preference_vectors has no embedding_source_hash/embedding_updated_at
-- columns (it's recomputed wholesale by its own batch job, not incrementally
-- backfilled) — nothing to reset there beyond the column type change above.

-- 4. ── Recreate the two HNSW indexes against the new vector(768) columns ─────
CREATE INDEX IF NOT EXISTS idx_startups_embedding_hnsw
  ON startups USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_investors_embedding_hnsw
  ON investors USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. ── Update column comments to stop describing OpenAI/1536-d ──────────────
COMMENT ON COLUMN startups.embedding IS
  'nomic-ai/nomic-embed-text-v1.5 (768-d, self-hosted TEI on RunPod) embedding of the company''s semantic profile (name + industry + description). Populated by the backfill-embeddings Edge Function. NULL = not yet embedded.';
COMMENT ON COLUMN investors.embedding IS
  'nomic-ai/nomic-embed-text-v1.5 (768-d, self-hosted TEI on RunPod) embedding of the firm''s semantic profile (name + description + thesis). Populated by the backfill-embeddings Edge Function. NULL = not yet embedded.';
COMMENT ON COLUMN user_preference_vectors.embedding IS
  'Same 768-d nomic-embed-text-v1.5 space as startups.embedding/investors.embedding (20261005000000_update_embedding_vector_dimensions) — a centroid of real company embeddings the user has engaged with. No HNSW index here: queries always go startups.embedding <=> (this one user''s vector), which uses the existing index on startups, not one on this table.';

-- 6. ── Recreate match_companies_and_funds() with a vector(768) parameter ─────
-- Body is otherwise identical to 20260721000000_semantic_search_pgvector.sql
-- (only the parameter's declared dimension changes; every comparison inside
-- is dimension-agnostic) EXCEPT for one bundled bug fix discovered while
-- validating this migration locally: the function was declared STABLE while
-- its body executes `SET LOCAL hnsw.ef_search = 100` — PostgreSQL
-- unconditionally rejects a SET/SET LOCAL statement inside a STABLE (or
-- IMMUTABLE) function ("SET is not allowed in a non-volatile function"),
-- confirmed by reproducing the identical error against the untouched
-- original function body. That means every call to this RPC has errored
-- since its introduction, independent of this migration's dimension change.
-- Since this function is already being dropped and recreated here, the fix
-- (STABLE -> VOLATILE) rides along rather than shipping a still-broken
-- function under a new vector dimension.
DROP FUNCTION IF EXISTS match_companies_and_funds(extensions.vector, integer, double precision, text);

CREATE FUNCTION match_companies_and_funds(
  query_embedding extensions.vector(768),
  match_count     integer          DEFAULT 10,
  match_threshold double precision DEFAULT 0.0,
  entity_filter   text             DEFAULT 'all'   -- 'all' | 'startup' | 'investor'
)
RETURNS TABLE (
  entity_type text,
  id          uuid,
  name        text,
  slug        text,
  description text,
  similarity  double precision,
  metadata    jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Lift approximate-search recall for this query (default is 40). Higher =
  -- more candidates explored per probe = better top-K quality, minor latency.
  SET LOCAL hnsw.ef_search = 100;

  -- Each per-table CTE does its OWN `ORDER BY embedding <=> query LIMIT k`, which
  -- is the exact shape the HNSW index accelerates — so we fetch each table's top
  -- candidates via the index (no full-table distance scan), then merge and take
  -- the global top-K. Fetching match_count from each side guarantees the merged
  -- top match_count is correct even if one type dominates the results.
  RETURN QUERY
  WITH startup_hits AS (
    SELECT
      'startup'::text AS entity_type,
      s.id,
      s.name,
      s.slug,
      s.description,
      1 - (s.embedding <=> query_embedding) AS similarity,
      jsonb_build_object(
        'industry',     s.industry,
        'website',      s.website,
        'city',         s.city,
        'country',      s.country,
        'logo_url',     s.logo_url,
        'growth_trend', s.growth_trend
      ) AS metadata
    FROM startups s
    WHERE s.embedding IS NOT NULL
      AND entity_filter IN ('all', 'startup')
    ORDER BY s.embedding <=> query_embedding      -- index-accelerated ANN
    LIMIT match_count
  ),
  investor_hits AS (
    SELECT
      'investor'::text AS entity_type,
      i.id,
      i.name,
      i.slug,
      COALESCE(i.description, i.thesis) AS description,
      1 - (i.embedding <=> query_embedding) AS similarity,
      jsonb_build_object(
        'firm_type',    COALESCE(i.firm_type, 'vc'),
        'headquarters', i.headquarters,
        'fund_size',    i.fund_size,
        'website',      i.website,
        'thesis',       i.thesis,
        'tier',         i.tier
      ) AS metadata
    FROM investors i
    WHERE i.embedding IS NOT NULL
      AND entity_filter IN ('all', 'investor')
    ORDER BY i.embedding <=> query_embedding      -- index-accelerated ANN
    LIMIT match_count
  )
  SELECT r.entity_type, r.id, r.name, r.slug, r.description, r.similarity, r.metadata
  FROM (SELECT * FROM startup_hits UNION ALL SELECT * FROM investor_hits) r
  WHERE r.similarity >= match_threshold
  ORDER BY r.similarity DESC
  LIMIT LEAST(GREATEST(match_count, 1), 50);   -- hard cap: never return > 50
END;
$$;

COMMENT ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text) IS
  'Semantic retrieval for the AI Search & Q&A Engine. Given a 768-d query embedding (nomic-embed-text-v1.5, self-hosted TEI), returns the top `match_count` startups and/or investors by cosine similarity (>= match_threshold), newest-relevance-first. entity_filter narrows to one type. Type-specific fields ride in `metadata` jsonb so the contract is stable.';

GRANT EXECUTE ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text)
  TO anon, authenticated, service_role;

-- ##############################################################################
-- ## 20261004000000_schedule_embedding_backfill.sql
-- ##############################################################################

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

-- ##############################################################################
-- ## 20260726190000_company_merge.sql
-- ##############################################################################

-- =============================================================================
-- Migration: physical company merge, reversible and non-destructive
-- Created:   2026-07-26
-- Description:
--   Two startups rows describing one company become one row, with every
--   dependent record repointed and the whole thing undoable.
--
-- ── THE RULE: GAP-FILL ONLY. NEVER OVERWRITE. ───────────────────────────────
--   A column on the surviving row is written ONLY if it is currently NULL (or
--   an empty string / empty array). If the survivor already holds a value, the
--   merged row's value is discarded and the column name is recorded in
--   skipped_columns.
--
--   This is not caution for its own sake. Enrichment is expensive and often
--   manual: descriptions, investor tiers, funding history, sector assignments.
--   A merge that overwrites an enriched description with a government
--   registry's blank-ish one destroys work that cost real money, and does it
--   silently. Filling a gap can only add.
--
--   ARRAYS are the exception, and they are still additive: text[] and jsonb
--   arrays are UNIONed rather than replaced, because a union is strictly richer
--   and cannot lose anything the survivor had. jsonb OBJECTS are not merged —
--   combining two objects key-by-key means picking a winner per key, which is
--   an overwrite wearing a different hat.
--
--   KNOWN LIMITATION of gap-fill-only, worth stating rather than discovering:
--   a column with a NOT NULL default is never "empty", so it never fills. If
--   the survivor has is_serial_founder = false (the default, meaning nobody
--   looked) and the merged row has true (meaning somebody did), the false wins
--   and the finding is lost. Distinguishing "checked and false" from "never
--   checked" is impossible without a third state, and inferring one would
--   violate the never-overwrite rule outright. Such columns appear in
--   skipped_columns, so the loss is at least visible in the audit.
--
-- ── WHICH ROW SURVIVES IS COMPUTED, NOT CHOSEN ──────────────────────────────
--   company_richness() counts populated fields, weighting the expensive ones —
--   an embedding, a description, funding history. The richer row survives.
--   Picking arbitrarily (say, the older id) would sometimes make the thin row
--   the survivor, and gap-fill-only would then leave most of the good data
--   stranded in the row about to be deleted.
--
-- ── FOREIGN KEYS ARE DISCOVERED, NOT LISTED ─────────────────────────────────
--   There are nine FK references to startups across the migration history and
--   there will be more. A hard-coded list would be wrong the first time someone
--   adds a table and would fail silently — orphaning rows rather than erroring.
--   merge_companies() reads pg_constraint at run time, so it repoints whatever
--   exists today.
--
--   Repointing can violate a unique constraint (two watchlist rows for the same
--   user, one per duplicate company). Those collisions are resolved by deleting
--   the losing row and counting it, never by aborting the merge.
--
--   BUT DISCOVERY HAS A BLIND SPOT, and it is not a small one. A POLYMORPHIC
--   reference — watchlist_items holds either a startup or an investor id in one
--   entity_id column — cannot have a foreign key at all, because Postgres
--   cannot reference two tables from one constraint. pg_constraint therefore
--   knows nothing about it.
--
--   Without explicit handling, merging a company leaves every user's watchlist
--   entry pointing at a deleted row. Nothing errors; the watchlist just shows a
--   company that will not open. Those references are listed by hand in the
--   second repoint loop, and that list has to be maintained — there is nothing
--   to discover.
--
-- ── REVERSIBILITY ───────────────────────────────────────────────────────────
--   company_merges stores the complete pre-merge row as jsonb. unmerge_company()
--   restores it. What it CANNOT restore is which dependent rows originally
--   belonged to the merged company — repointing is one-way, because a FK column
--   holds one value and the old one is gone. Reversal therefore returns the
--   entity, not the relationships. That limitation is stated in the function
--   comment rather than discovered by someone relying on it.
--
-- Rollback: supabase/rollback/20260726190000_company_merge_down.sql
-- Tests:    supabase/tests/entity_resolution.test.sql
--
-- Idempotent.
-- =============================================================================

/**
 * How much enrichment does this row carry?
 *
 * Weighted, because the fields are not equally expensive to obtain. An
 * embedding costs an OpenAI call; a country code costs nothing. Weighting by
 * cost-to-reacquire means the survivor is the row that would hurt most to lose.
 */
CREATE OR REPLACE FUNCTION company_richness(p_startup_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r        record;
  score    integer := 0;
  col      text;
  weights  jsonb := '{
    "embedding": 10, "description": 8, "website": 6, "founded_year": 4,
    "industry": 3, "sector_id": 3, "employee_count": 3, "logo_url": 2,
    "linkedin_url": 3, "country": 1, "city": 1, "slug": 2
  }'::jsonb;
  v        jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v FROM startups s WHERE s.id = p_startup_id;
  IF v IS NULL THEN RETURN 0; END IF;

  -- Weighted columns.
  FOR col IN SELECT jsonb_object_keys(weights) LOOP
    IF v ? col AND v->>col IS NOT NULL AND btrim(v->>col) <> '' THEN
      score := score + (weights->>col)::int;
    END IF;
  END LOOP;

  -- Everything else counts 1, so a row rich in columns this function has never
  -- heard of still outranks an empty one. New columns need no code change.
  SELECT score + count(*)::int INTO score
    FROM jsonb_each_text(v) e
   WHERE e.key NOT IN ('id','created_at','updated_at')
     AND NOT (weights ? e.key)
     AND e.value IS NOT NULL AND btrim(e.value) <> '';

  -- Relationships are enrichment too, and the most expensive kind.
  SELECT score
       + 5 * (SELECT count(*) FROM funding_rounds  f WHERE f.startup_id = p_startup_id)
       + 3 * (SELECT count(*) FROM raw_gov_filings g WHERE g.startup_id = p_startup_id)
       + 4 * (SELECT count(*) FROM sourcing_companies c WHERE c.startup_id = p_startup_id)
    INTO score;

  RETURN score;
END;
$$;

COMMENT ON FUNCTION company_richness(uuid) IS
  'Weighted count of populated fields and attached records, weighted by cost-to-reacquire. Decides which row survives a merge, so that gap-fill-only never strands good data in the row being deleted.';

/**
 * Repoint every row in one table from the merged company to the survivor.
 *
 * Returns {"moved": n, "dropped": n}.
 *
 * ── WHY THIS IS ROW-AT-A-TIME ON COLLISION ─────────────────────────────────
 * The obvious implementation is one UPDATE, and on unique_violation delete the
 * loser's rows. That is wrong, and wrong in a way that quietly loses user data:
 * a single colliding row aborts the whole statement, and the blanket DELETE
 * then removes every row for the merged company — including the ones that had
 * no conflict at all and would have repointed cleanly.
 *
 * Observed before the fix: a user who had watchlisted ONLY the duplicate lost
 * their entry entirely, because a DIFFERENT user happened to have watchlisted
 * both.
 *
 * So the bulk path is tried first (fast, and the common case), and only on a
 * collision does it fall back to per-row: update what can move, delete only
 * what genuinely conflicts.
 *
 * ── WHY check_violation IS TREATED THE SAME AS unique_violation ────────────
 * entity_match_candidates has CHECK (NOT (left_kind='startup' AND left_id =
 * right_startup_id)) — a pair cannot be a pair with itself. Repointing the
 * candidate that DESCRIBES the merge being performed makes both columns equal
 * and trips exactly that check.
 *
 * Which is not an error condition; it is the correct outcome arriving as one.
 * Once the two rows are one row, a candidate proposing to link them is
 * meaningless. Letting it abort would mean the review queue could never
 * confirm anything — the one operation it exists for. So a row that cannot be
 * repointed is dropped and counted, the same policy already applied to unique
 * collisions.
 *
 * The decision itself is not lost: merge_companies() records the merge in
 * company_merges with the candidate id and tier in its evidence, which is the
 * durable audit. The candidate row was going to disappear regardless —
 * right_startup_id is ON DELETE CASCADE.
 */
CREATE OR REPLACE FUNCTION repoint_startup_refs(
  p_table     text,
  p_id_column text,
  p_survivor  uuid,
  p_loser     uuid,
  p_extra_col text DEFAULT NULL,
  p_extra_val text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_where text;
  v_pk    text;
  v_moved bigint := 0;
  v_drop  bigint := 0;
  r       record;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RETURN jsonb_build_object('moved', 0, 'dropped', 0);
  END IF;

  v_where := format('%I = %L', p_id_column, p_loser);
  IF p_extra_col IS NOT NULL THEN
    v_where := v_where || format(' AND %I = %L', p_extra_col, p_extra_val);
  END IF;

  -- Fast path.
  BEGIN
    EXECUTE format('UPDATE %I SET %I = %L WHERE %s', p_table, p_id_column, p_survivor, v_where);
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RETURN jsonb_build_object('moved', v_moved, 'dropped', 0);
  EXCEPTION WHEN unique_violation OR check_violation THEN
    NULL;  -- fall through
  END;

  -- Precise path. Needs a single-column primary key to address rows
  -- individually; without one there is no safe way to be surgical, so the
  -- blanket behaviour is kept and reported honestly as such.
  SELECT a.attname INTO v_pk
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
   WHERE i.indrelid = ('public.' || p_table)::regclass
     AND i.indisprimary
     AND array_length(i.indkey::int[], 1) = 1;

  IF v_pk IS NULL THEN
    EXECUTE format('DELETE FROM %I WHERE %s', p_table, v_where);
    GET DIAGNOSTICS v_drop = ROW_COUNT;
    RETURN jsonb_build_object('moved', 0, 'dropped', v_drop, 'note', 'no single-column PK; blanket delete');
  END IF;

  FOR r IN EXECUTE format('SELECT %I AS pk FROM %I WHERE %s', v_pk, p_table, v_where)
  LOOP
    BEGIN
      EXECUTE format('UPDATE %I SET %I = %L WHERE %I = %L',
                     p_table, p_id_column, p_survivor, v_pk, r.pk);
      v_moved := v_moved + 1;
    EXCEPTION WHEN unique_violation OR check_violation THEN
      -- This specific row would either duplicate one the survivor already has,
      -- or become self-referential (a candidate proposing to link the survivor
      -- to itself). Both mean the row has no meaning after the merge.
      EXECUTE format('DELETE FROM %I WHERE %I = %L', p_table, v_pk, r.pk);
      v_drop := v_drop + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('moved', v_moved, 'dropped', v_drop);
END;
$$;

COMMENT ON FUNCTION repoint_startup_refs(text,text,uuid,uuid,text,text) IS
  'Moves one table''s rows from a merged company to the survivor. Falls back from a bulk UPDATE to per-row on a unique collision, so rows that do NOT conflict are never collateral damage — the failure mode a blanket delete produces silently.';

/**
 * Merge p_merged_id into p_surviving_id. Returns the audit row id.
 *
 * Pass NULL for p_surviving_id to let company_richness() choose — which is the
 * intended usage. Explicit survivor selection exists for the review queue,
 * where a human may know something the score does not.
 */
CREATE OR REPLACE FUNCTION merge_companies(
  p_a          uuid,
  p_b          uuid,
  p_surviving_id uuid DEFAULT NULL,
  p_evidence   jsonb DEFAULT '{}'::jsonb,
  p_merged_by  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor  uuid;
  v_loser     uuid;
  v_snapshot  jsonb;
  v_survivor_row jsonb;
  v_filled    text[] := '{}';
  v_skipped   text[] := '{}';
  v_repointed jsonb  := '{}'::jsonb;
  v_merge_id  uuid;
  rec         record;
  col         text;
  coltype     text;
  n           bigint;
  v_res       jsonb;
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RAISE EXCEPTION 'merge_companies: need two distinct startup ids (got %, %)', p_a, p_b;
  END IF;

  -- Decide the survivor before touching anything.
  IF p_surviving_id IS NOT NULL THEN
    IF p_surviving_id NOT IN (p_a, p_b) THEN
      RAISE EXCEPTION 'merge_companies: p_surviving_id % is neither of the two rows', p_surviving_id;
    END IF;
    v_survivor := p_surviving_id;
    v_loser    := CASE WHEN p_surviving_id = p_a THEN p_b ELSE p_a END;
  ELSIF company_richness(p_a) >= company_richness(p_b) THEN
    v_survivor := p_a; v_loser := p_b;
  ELSE
    v_survivor := p_b; v_loser := p_a;
  END IF;

  SELECT to_jsonb(s) INTO v_snapshot FROM startups s WHERE s.id = v_loser;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_companies: startup % does not exist', v_loser;
  END IF;
  SELECT to_jsonb(s) INTO v_survivor_row FROM startups s WHERE s.id = v_survivor;
  IF v_survivor_row IS NULL THEN
    RAISE EXCEPTION 'merge_companies: startup % does not exist', v_survivor;
  END IF;

  -- ── Column-by-column gap fill ─────────────────────────────────────────────
  -- Driven off the catalogue, so a new column is handled without touching this
  -- function.
  --
  -- pg_attribute + format_type(), NOT information_schema.data_type. For a
  -- user-defined type like vector(1536) data_type returns the literal string
  -- 'USER-DEFINED', and for text[] it returns 'ARRAY' — casting to either is a
  -- syntax error. format_type() returns the real declared type WITH its
  -- modifiers, which is what a cast needs. This surfaced the moment the schema
  -- contained a pgvector column.
  FOR rec IN
    SELECT a.attname                                AS column_name,
           format_type(a.atttypid, a.atttypmod)     AS decl_type,
           t.typname                                AS udt_name
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = 'public.startups'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attgenerated = ''
       -- attgenerated = '' above already excludes search_tsv, which is
       -- GENERATED ALWAYS AS (...) STORED and recomputes itself from name,
       -- industry and description. Naming it here is belt-and-braces: if it
       -- were ever redefined as a plain trigger-maintained column, copying a
       -- stale value in would make the survivor briefly searchable under the
       -- merged company's terms.
       AND a.attname NOT IN ('id', 'created_at', 'updated_at', 'search_tsv')
     ORDER BY a.attnum
  LOOP
    col     := rec.column_name;
    coltype := rec.udt_name;

    -- Nothing to take.
    CONTINUE WHEN v_snapshot->>col IS NULL OR btrim(coalesce(v_snapshot->>col, '')) IN ('', '[]', '{}');

    IF coltype = '_text' THEN
      -- Text arrays UNION. Strictly additive: the survivor keeps everything it
      -- had and gains what it lacked, so this cannot lose data even though it
      -- writes over a non-null value.
      EXECUTE format(
        'UPDATE startups SET %I = (
           SELECT array_agg(DISTINCT x) FROM (
             SELECT unnest(coalesce(%I, ''{}'')) AS x FROM startups WHERE id = $1
             UNION
             SELECT unnest(coalesce((SELECT array_agg(y) FROM jsonb_array_elements_text($2->%L) y), ''{}''))
           ) u WHERE x IS NOT NULL
         ) WHERE id = $1', col, col, col)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || (col || ' (union)');

    ELSIF coltype = 'jsonb'
      AND jsonb_typeof(v_snapshot->col) = 'array'
      AND jsonb_typeof(v_survivor_row->col) = 'array' THEN
      -- jsonb ARRAYS union too, for the same reason text arrays do.
      --
      -- This branch exists because `founders` is jsonb, not text[] — it was
      -- migrated (founders text[] -> founders_jsonb jsonb -> renamed back).
      -- Without it, founders fell through to gap-fill-only and a merge silently
      -- discarded every founder the survivor did not already list. Which is
      -- precisely the data loss the gap-fill rule exists to prevent, arriving
      -- through the one column most likely to matter.
      --
      -- Deliberately array-only, checked at RUN TIME rather than by column
      -- type: `leadership`, `data_sources` and `investor_amounts` are jsonb
      -- OBJECTS, and merging two objects key-by-key means choosing a winner per
      -- key — an overwrite by another name. Objects stay gap-fill-only.
      EXECUTE format(
        'UPDATE startups SET %I = (
           SELECT jsonb_agg(DISTINCT e) FROM (
             SELECT jsonb_array_elements(%I) AS e FROM startups WHERE id = $1
             UNION
             SELECT jsonb_array_elements($2->%L)
           ) u
         ) WHERE id = $1', col, col, col)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || (col || ' (jsonb union)');

    ELSIF v_survivor_row->>col IS NULL OR btrim(coalesce(v_survivor_row->>col, '')) = '' THEN
      -- THE GAP FILL. Only ever writes into a hole.
      EXECUTE format('UPDATE startups SET %I = ($2->>%L)::%s WHERE id = $1',
                     col, col, rec.decl_type)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || col;

    ELSE
      -- Survivor already has a value. Leave it alone and say so.
      v_skipped := v_skipped || col;
    END IF;
  END LOOP;

  -- ── Repoint every foreign key that references startups ────────────────────
  FOR rec IN
    SELECT con.conrelid::regclass::text AS tbl,
           att.attname                  AS col
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND con.confrelid = 'startups'::regclass
       AND con.conrelid <> 'startups'::regclass
  LOOP
    v_res := repoint_startup_refs(
      regexp_replace(rec.tbl, '^public\.', ''), rec.col, v_survivor, v_loser);
    IF (v_res->>'moved')::bigint > 0 OR (v_res->>'dropped')::bigint > 0 THEN
      v_repointed := v_repointed || jsonb_build_object(rec.tbl || '.' || rec.col, v_res);
    END IF;
  END LOOP;

  -- ── Polymorphic references, which pg_constraint CANNOT find ───────────────
  -- The FK sweep above is blind to a column that points at startups without a
  -- foreign key. That is not an oversight in those tables — watchlist_items
  -- holds either a startup or an investor id in one column, and Postgres has no
  -- way to reference two tables from one constraint. The table's own comment
  -- says as much.
  --
  -- The consequence if this loop did not exist: merging a company leaves every
  -- user's watchlist entry pointing at a row that no longer exists. Nothing
  -- errors. The watchlist simply shows a company that cannot be opened.
  --
  -- This list therefore MUST be maintained by hand — there is nothing in the
  -- catalogue to discover. A new polymorphic reference to startups has to be
  -- added here, and the cost of forgetting is silent breakage.
  FOR rec IN
    SELECT * FROM (VALUES
      -- table,                    id column,   discriminator, value for a company
      ('watchlist_items',          'entity_id', 'entity_type', 'startup'),
      ('entity_match_candidates',  'left_id',   'left_kind',   'startup')
      -- company_merges.merged_id is deliberately NOT here: it points at a row
      -- that has been deleted on purpose, and repointing it would destroy the
      -- audit trail this whole function depends on.
    ) AS t(tbl, idcol, typecol, typeval)
  LOOP
    v_res := repoint_startup_refs(rec.tbl, rec.idcol, v_survivor, v_loser,
                                  rec.typecol, rec.typeval);
    IF (v_res->>'moved')::bigint > 0 OR (v_res->>'dropped')::bigint > 0 THEN
      v_repointed := v_repointed
        || jsonb_build_object(rec.tbl || '.' || rec.idcol || ' (polymorphic)', v_res);
    END IF;
  END LOOP;

  -- Record BEFORE deleting, so the audit exists even if the delete fails.
  INSERT INTO company_merges (
    surviving_id, merged_id, merged_snapshot, filled_columns, skipped_columns,
    repointed, evidence, merged_by
  ) VALUES (
    v_survivor, v_loser, v_snapshot, v_filled, v_skipped, v_repointed, p_evidence, p_merged_by
  ) RETURNING id INTO v_merge_id;

  DELETE FROM startups WHERE id = v_loser;

  UPDATE startups SET updated_at = now() WHERE id = v_survivor;

  RETURN v_merge_id;
END;
$$;

COMMENT ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) IS
  'Merges two startups rows. Columns are GAP-FILLED ONLY — an existing value on the survivor is never overwritten, only recorded in skipped_columns; text arrays are unioned, which is additive. The survivor is chosen by company_richness() unless named explicitly. Foreign keys are discovered from pg_constraint at run time, so tables added later are handled without editing this function.';

/**
 * Undo a merge: restore the deleted company from its snapshot.
 *
 * WHAT THIS DOES NOT DO, stated plainly: it cannot return the dependent rows
 * that were repointed. A foreign key column holds one value, and the old one
 * was overwritten — the information is gone. Reversal restores the ENTITY, not
 * its relationships. It also cannot un-fill columns, because by then a later
 * enrichment may have refined them and blanking those would destroy newer work.
 *
 * So this is a safety net for "we merged the wrong pair", recovering the
 * company record itself, not a transaction rollback.
 */
CREATE OR REPLACE FUNCTION unmerge_company(p_merge_id uuid, p_by text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m       record;
  cols    text;
  vals    text;
  new_id  uuid;
BEGIN
  SELECT * INTO m FROM company_merges WHERE id = p_merge_id;
  IF m IS NULL THEN
    RAISE EXCEPTION 'unmerge_company: no merge record %', p_merge_id;
  END IF;
  IF m.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'unmerge_company: merge % was already reversed at %', p_merge_id, m.reversed_at;
  END IF;
  IF EXISTS (SELECT 1 FROM startups WHERE id = m.merged_id) THEN
    RAISE EXCEPTION 'unmerge_company: startup % already exists — nothing to restore', m.merged_id;
  END IF;

  -- Restore only columns that still exist, so a snapshot taken before a schema
  -- change can still be restored.
  -- format_type() again, for the same reason as merge_companies().
  --
  -- GENERATED and IDENTITY columns are excluded, and that exclusion is load-
  -- bearing rather than tidiness. to_jsonb(s) captures every column including
  -- computed ones, so the snapshot contains search_tsv — a
  -- GENERATED ALWAYS AS (...) STORED tsvector. Naming it in an INSERT is a hard
  -- error: 'cannot insert a non-DEFAULT value into column "search_tsv"'.
  -- Without these two filters unmerge_company() cannot restore ANY row on a
  -- schema that has a generated column, which is to say it never worked at all.
  -- Nothing is lost by skipping them: a generated column is recomputed from the
  -- columns that ARE restored, and an identity value is reissued.
  --
  -- merge_companies() gets this right via the same attgenerated test, which is
  -- why merging worked while reversing did not.
  SELECT string_agg(quote_ident(k.key), ', '),
         string_agg(format('($1->>%L)::%s', k.key, format_type(a.atttypid, a.atttypmod)), ', ')
    INTO cols, vals
    FROM jsonb_object_keys(m.merged_snapshot) k(key)
    JOIN pg_attribute a
      ON a.attrelid = 'public.startups'::regclass
     AND a.attname = k.key
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = ''      -- GENERATED ALWAYS AS ... STORED
     AND a.attidentity <> 'a'     -- GENERATED ALWAYS AS IDENTITY
   WHERE m.merged_snapshot->>k.key IS NOT NULL;

  EXECUTE format('INSERT INTO startups (%s) VALUES (%s) RETURNING id', cols, vals)
    USING m.merged_snapshot INTO new_id;

  UPDATE company_merges
     SET reversed_at = now(),
         evidence = evidence || jsonb_build_object('reversed_by', p_by)
   WHERE id = p_merge_id;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION unmerge_company(uuid, text) IS
  'Restores a merged-away company from its snapshot. Does NOT restore repointed dependent rows — a foreign key holds one value and the old one is gone — nor un-fill columns, since later enrichment may have refined them. A safety net for a wrong pairing, not a transaction rollback.';

REVOKE ALL ON FUNCTION company_richness(uuid) FROM PUBLIC, anon;
-- SECURITY INVOKER, so it cannot exceed the caller's own rights — but it is a
-- dynamic-SQL surface that exists only to serve merge_companies(), and inside
-- that SECURITY DEFINER function it runs as the definer regardless of grants.
-- Nothing outside should be able to reach it.
REVOKE ALL ON FUNCTION repoint_startup_refs(text,text,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION unmerge_company(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION company_richness(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION unmerge_company(uuid, text) TO service_role;

-- ##############################################################################
-- ## 20261012000000_merge_unique_values_and_cron_cleanup.sql
-- ##############################################################################

-- =============================================================================
-- Migration: merge_companies frees unique values; stop weekly-startup-enrichment
-- Created:   2026-10-12
-- Description:
--   Found by the pipeline monitoring added in 20261011000000 (cron history):
--
--   1. resolve-tier1-identity has failed on every run:
--        duplicate key value violates unique constraint "uq_startups_slug"
--        Key (slug)=(digicert) already exists.
--        ... UPDATE startups SET slug = ($2->>'slug')::text WHERE id = $1
--      merge_companies() gap-fills the survivor's empty slug from the company
--      being merged away — while that row still holds the slug. One collision
--      aborts the whole batch, so no Tier 1 merge has ever completed.
--      Fix: clear every single-column unique value on the loser before the
--      gap fill (the loser is deleted at the end anyway; the snapshot keeps
--      its values for the audit row and unmerge_company()). The rest of the
--      function is the current 20260726190000_company_merge.sql version.
--
--   2. weekly-startup-enrichment — a job created by hand in the database (it
--      is in no migration) running CALL run_enrichment() — fails on every run:
--        column "body" does not exist ... FROM net._http_response
--      (pg_net's column is "content"). It is the old v1 enrichment path, and
--      automatic enrichment must not run on v1 (it waits for v2). The job is
--      unscheduled; run_enrichment() itself is left untouched.
--
-- Rollback: supabase/rollback/20261012000000_merge_unique_values_and_cron_cleanup_down.sql
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION merge_companies(
  p_a          uuid,
  p_b          uuid,
  p_surviving_id uuid DEFAULT NULL,
  p_evidence   jsonb DEFAULT '{}'::jsonb,
  p_merged_by  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor  uuid;
  v_loser     uuid;
  v_snapshot  jsonb;
  v_survivor_row jsonb;
  v_filled    text[] := '{}';
  v_skipped   text[] := '{}';
  v_repointed jsonb  := '{}'::jsonb;
  v_merge_id  uuid;
  rec         record;
  col         text;
  coltype     text;
  n           bigint;
  v_res       jsonb;
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RAISE EXCEPTION 'merge_companies: need two distinct startup ids (got %, %)', p_a, p_b;
  END IF;

  -- Decide the survivor before touching anything.
  IF p_surviving_id IS NOT NULL THEN
    IF p_surviving_id NOT IN (p_a, p_b) THEN
      RAISE EXCEPTION 'merge_companies: p_surviving_id % is neither of the two rows', p_surviving_id;
    END IF;
    v_survivor := p_surviving_id;
    v_loser    := CASE WHEN p_surviving_id = p_a THEN p_b ELSE p_a END;
  ELSIF company_richness(p_a) >= company_richness(p_b) THEN
    v_survivor := p_a; v_loser := p_b;
  ELSE
    v_survivor := p_b; v_loser := p_a;
  END IF;

  SELECT to_jsonb(s) INTO v_snapshot FROM startups s WHERE s.id = v_loser;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_companies: startup % does not exist', v_loser;
  END IF;
  SELECT to_jsonb(s) INTO v_survivor_row FROM startups s WHERE s.id = v_survivor;
  IF v_survivor_row IS NULL THEN
    RAISE EXCEPTION 'merge_companies: startup % does not exist', v_survivor;
  END IF;

  -- ── Free the loser's unique values before the gap fill ─────────────────────
  -- A column with its own unique index (slug) cannot be gap-filled onto the
  -- survivor while the row being merged away still holds the same value:
  -- "duplicate key value violates unique constraint uq_startups_slug" aborted
  -- every resolve_tier1 run (DigiCert). The loser is deleted at the end of
  -- this function anyway, and v_snapshot above keeps its values for the audit
  -- row and for unmerge_company().
  FOR col IN
    SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = 'public.startups'::regclass
       AND i.indisunique AND NOT i.indisprimary
       AND i.indnkeyatts = 1
       AND NOT a.attnotnull
       AND a.attgenerated = ''
  LOOP
    EXECUTE format('UPDATE startups SET %I = NULL WHERE id = $1', col) USING v_loser;
  END LOOP;

  -- ── Column-by-column gap fill ─────────────────────────────────────────────
  -- Driven off the catalogue, so a new column is handled without touching this
  -- function.
  --
  -- pg_attribute + format_type(), NOT information_schema.data_type. For a
  -- user-defined type like vector(1536) data_type returns the literal string
  -- 'USER-DEFINED', and for text[] it returns 'ARRAY' — casting to either is a
  -- syntax error. format_type() returns the real declared type WITH its
  -- modifiers, which is what a cast needs. This surfaced the moment the schema
  -- contained a pgvector column.
  FOR rec IN
    SELECT a.attname                                AS column_name,
           format_type(a.atttypid, a.atttypmod)     AS decl_type,
           t.typname                                AS udt_name
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = 'public.startups'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attgenerated = ''
       -- attgenerated = '' above already excludes search_tsv, which is
       -- GENERATED ALWAYS AS (...) STORED and recomputes itself from name,
       -- industry and description. Naming it here is belt-and-braces: if it
       -- were ever redefined as a plain trigger-maintained column, copying a
       -- stale value in would make the survivor briefly searchable under the
       -- merged company's terms.
       AND a.attname NOT IN ('id', 'created_at', 'updated_at', 'search_tsv')
     ORDER BY a.attnum
  LOOP
    col     := rec.column_name;
    coltype := rec.udt_name;

    -- Nothing to take.
    CONTINUE WHEN v_snapshot->>col IS NULL OR btrim(coalesce(v_snapshot->>col, '')) IN ('', '[]', '{}');

    IF coltype = '_text' THEN
      -- Text arrays UNION. Strictly additive: the survivor keeps everything it
      -- had and gains what it lacked, so this cannot lose data even though it
      -- writes over a non-null value.
      EXECUTE format(
        'UPDATE startups SET %I = (
           SELECT array_agg(DISTINCT x) FROM (
             SELECT unnest(coalesce(%I, ''{}'')) AS x FROM startups WHERE id = $1
             UNION
             SELECT unnest(coalesce((SELECT array_agg(y) FROM jsonb_array_elements_text($2->%L) y), ''{}''))
           ) u WHERE x IS NOT NULL
         ) WHERE id = $1', col, col, col)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || (col || ' (union)');

    ELSIF coltype = 'jsonb'
      AND jsonb_typeof(v_snapshot->col) = 'array'
      AND jsonb_typeof(v_survivor_row->col) = 'array' THEN
      -- jsonb ARRAYS union too, for the same reason text arrays do.
      --
      -- This branch exists because `founders` is jsonb, not text[] — it was
      -- migrated (founders text[] -> founders_jsonb jsonb -> renamed back).
      -- Without it, founders fell through to gap-fill-only and a merge silently
      -- discarded every founder the survivor did not already list. Which is
      -- precisely the data loss the gap-fill rule exists to prevent, arriving
      -- through the one column most likely to matter.
      --
      -- Deliberately array-only, checked at RUN TIME rather than by column
      -- type: `leadership`, `data_sources` and `investor_amounts` are jsonb
      -- OBJECTS, and merging two objects key-by-key means choosing a winner per
      -- key — an overwrite by another name. Objects stay gap-fill-only.
      EXECUTE format(
        'UPDATE startups SET %I = (
           SELECT jsonb_agg(DISTINCT e) FROM (
             SELECT jsonb_array_elements(%I) AS e FROM startups WHERE id = $1
             UNION
             SELECT jsonb_array_elements($2->%L)
           ) u
         ) WHERE id = $1', col, col, col)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || (col || ' (jsonb union)');

    ELSIF v_survivor_row->>col IS NULL OR btrim(coalesce(v_survivor_row->>col, '')) = '' THEN
      -- THE GAP FILL. Only ever writes into a hole.
      EXECUTE format('UPDATE startups SET %I = ($2->>%L)::%s WHERE id = $1',
                     col, col, rec.decl_type)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || col;

    ELSE
      -- Survivor already has a value. Leave it alone and say so.
      v_skipped := v_skipped || col;
    END IF;
  END LOOP;

  -- ── Repoint every foreign key that references startups ────────────────────
  FOR rec IN
    SELECT con.conrelid::regclass::text AS tbl,
           att.attname                  AS col
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND con.confrelid = 'startups'::regclass
       AND con.conrelid <> 'startups'::regclass
  LOOP
    v_res := repoint_startup_refs(
      regexp_replace(rec.tbl, '^public\.', ''), rec.col, v_survivor, v_loser);
    IF (v_res->>'moved')::bigint > 0 OR (v_res->>'dropped')::bigint > 0 THEN
      v_repointed := v_repointed || jsonb_build_object(rec.tbl || '.' || rec.col, v_res);
    END IF;
  END LOOP;

  -- ── Polymorphic references, which pg_constraint CANNOT find ───────────────
  -- The FK sweep above is blind to a column that points at startups without a
  -- foreign key. That is not an oversight in those tables — watchlist_items
  -- holds either a startup or an investor id in one column, and Postgres has no
  -- way to reference two tables from one constraint. The table's own comment
  -- says as much.
  --
  -- The consequence if this loop did not exist: merging a company leaves every
  -- user's watchlist entry pointing at a row that no longer exists. Nothing
  -- errors. The watchlist simply shows a company that cannot be opened.
  --
  -- This list therefore MUST be maintained by hand — there is nothing in the
  -- catalogue to discover. A new polymorphic reference to startups has to be
  -- added here, and the cost of forgetting is silent breakage.
  FOR rec IN
    SELECT * FROM (VALUES
      -- table,                    id column,   discriminator, value for a company
      ('watchlist_items',          'entity_id', 'entity_type', 'startup'),
      ('entity_match_candidates',  'left_id',   'left_kind',   'startup')
      -- company_merges.merged_id is deliberately NOT here: it points at a row
      -- that has been deleted on purpose, and repointing it would destroy the
      -- audit trail this whole function depends on.
    ) AS t(tbl, idcol, typecol, typeval)
  LOOP
    v_res := repoint_startup_refs(rec.tbl, rec.idcol, v_survivor, v_loser,
                                  rec.typecol, rec.typeval);
    IF (v_res->>'moved')::bigint > 0 OR (v_res->>'dropped')::bigint > 0 THEN
      v_repointed := v_repointed
        || jsonb_build_object(rec.tbl || '.' || rec.idcol || ' (polymorphic)', v_res);
    END IF;
  END LOOP;

  -- Record BEFORE deleting, so the audit exists even if the delete fails.
  INSERT INTO company_merges (
    surviving_id, merged_id, merged_snapshot, filled_columns, skipped_columns,
    repointed, evidence, merged_by
  ) VALUES (
    v_survivor, v_loser, v_snapshot, v_filled, v_skipped, v_repointed, p_evidence, p_merged_by
  ) RETURNING id INTO v_merge_id;

  DELETE FROM startups WHERE id = v_loser;

  UPDATE startups SET updated_at = now() WHERE id = v_survivor;

  RETURN v_merge_id;
END;
$$;

COMMENT ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) IS
  'Merges two startups rows. Columns are GAP-FILLED ONLY — an existing value on the survivor is never overwritten, only recorded in skipped_columns; text arrays are unioned, which is additive. The survivor is chosen by company_richness() unless named explicitly. Foreign keys are discovered from pg_constraint at run time, so tables added later are handled without editing this function.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-startup-enrichment') THEN
    PERFORM cron.unschedule('weekly-startup-enrichment');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) TO service_role;
