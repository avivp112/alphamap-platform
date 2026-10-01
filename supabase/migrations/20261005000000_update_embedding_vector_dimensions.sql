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
