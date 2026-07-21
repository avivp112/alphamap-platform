-- =============================================================================
-- Migration: semantic_search_pgvector
-- Created:   2026-07-21
-- Description: Phase 1 of the AlphaMap AI Search & Q&A Engine — the semantic
--              retrieval substrate. Turns `startups` and `investors` into a
--              vector-searchable knowledge base so the Market Intelligence
--              Agent answers strictly from OUR data (retrieval-augmented, not
--              free-generation) and can't hallucinate companies/funds that
--              aren't in the database.
--
--   1. Enable pgvector (installed into the `extensions` schema, per Supabase
--      convention — never into `public`).
--   2. Add an `embedding vector(1536)` column to `startups` and `investors`
--      (1536 = OpenAI text-embedding-3-small output dimensionality), plus two
--      bookkeeping columns that make the backfill INCREMENTAL and idempotent:
--        - embedding_source_hash  — md5 of the exact text that was embedded, so
--          scripts/backfill_embeddings.ts can skip a row whose source text
--          hasn't changed (no wasted OpenAI spend on re-runs).
--        - embedding_updated_at   — self-advancing queue stamp (NULL = never
--          embedded → picked up first), same mechanism as last_enriched_at.
--   3. HNSW cosine indexes for fast approximate-nearest-neighbour recall at
--      scale (HNSW > IVFFlat here: no training step, better recall/latency,
--      and it stays correct as the table grows without periodic REINDEX).
--   4. match_companies_and_funds() — the retrieval RPC. Takes a query embedding
--      and returns the top-K most semantically similar startups AND investors
--      in one unified, ranked result set (cosine similarity), with optional
--      entity-type and minimum-similarity filters. Stable JSON contract:
--      type-specific fields ride along in a `metadata` jsonb so the return
--      shape never has to change as either table gains columns.
--
-- Cosine similarity note: we store raw (un-normalised) embeddings and use the
-- `<=>` cosine-distance operator; similarity is reported as 1 - distance, so
-- 1.0 = identical direction, 0.0 = orthogonal. The HNSW index uses
-- vector_cosine_ops so ORDER BY embedding <=> query is index-accelerated.
--
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

-- 1. ── Extension ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. ── Embedding columns + bookkeeping ───────────────────────────────────────
ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS embedding             extensions.vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_source_hash text,
  ADD COLUMN IF NOT EXISTS embedding_updated_at  timestamptz;

COMMENT ON COLUMN startups.embedding IS
  'OpenAI text-embedding-3-small (1536-d) embedding of the company''s semantic profile (name + industry + description). Populated by scripts/backfill_embeddings.ts. NULL = not yet embedded.';
COMMENT ON COLUMN startups.embedding_source_hash IS
  'md5 of the exact text that produced `embedding`. The backfill skips a row whose freshly-composed source text hashes to this value — makes re-runs cheap and incremental.';
COMMENT ON COLUMN startups.embedding_updated_at IS
  'When `embedding` was last (re)computed. NULL = never — such rows sort first, so repeated backfill runs walk the whole table without OFFSET arithmetic.';

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS embedding             extensions.vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_source_hash text,
  ADD COLUMN IF NOT EXISTS embedding_updated_at  timestamptz;

COMMENT ON COLUMN investors.embedding IS
  'OpenAI text-embedding-3-small (1536-d) embedding of the firm''s semantic profile (name + description + thesis). Populated by scripts/backfill_embeddings.ts. NULL = not yet embedded.';
COMMENT ON COLUMN investors.embedding_source_hash IS
  'md5 of the exact text that produced `embedding` — enables the incremental / skip-unchanged backfill.';
COMMENT ON COLUMN investors.embedding_updated_at IS
  'When `embedding` was last (re)computed. NULL = never — picked up first by the backfill queue.';

-- 3. ── HNSW cosine indexes ───────────────────────────────────────────────────
-- m / ef_construction tuned for a directory-scale corpus (tens of thousands of
-- rows): higher ef_construction = better recall at slightly slower build. Query
-- recall is tuned at read time via `SET hnsw.ef_search` inside the RPC.
CREATE INDEX IF NOT EXISTS idx_startups_embedding_hnsw
  ON startups USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_investors_embedding_hnsw
  ON investors USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. ── Retrieval RPC ─────────────────────────────────────────────────────────
-- Returns startups and investors interleaved and ranked by cosine similarity to
-- the query embedding. One call, one ranked list — the caller (Edge Function /
-- agent) gets exactly the grounding context it needs and nothing it doesn't.
DROP FUNCTION IF EXISTS match_companies_and_funds(extensions.vector, integer, double precision, text);

CREATE FUNCTION match_companies_and_funds(
  query_embedding extensions.vector(1536),
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
STABLE
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
  'Semantic retrieval for the AI Search & Q&A Engine. Given a 1536-d query embedding, returns the top `match_count` startups and/or investors by cosine similarity (>= match_threshold), newest-relevance-first. entity_filter narrows to one type. Type-specific fields ride in `metadata` jsonb so the contract is stable.';

GRANT EXECUTE ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text)
  TO anon, authenticated, service_role;
